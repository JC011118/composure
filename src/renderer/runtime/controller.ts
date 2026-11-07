/**
 * SessionController: owns one rehearsal session in the renderer.
 *
 * Builds the right SignalSource for the boot mode (real SDK, simulator,
 * replay, or camera-free), the InterviewEngine, the interviewer voice, and the
 * optional recording tap, and wires them together. React reads its state
 * through the stores below.
 */

import { DEFAULT_CONFIG, mergeConfig, type DeepPartial, type EngineConfig } from '../../engine/config';
import { InterviewEngine } from '../../engine/engine';
import { buildInsightPrompt } from '../../engine/insightPrompt';
import { redactBannedTerms } from '../../engine/lexicon';
import { selectQuestions } from '../../engine/questions';
import { parseSession, serializeSession, type InsightRecord, type SessionRecord } from '../../engine/session';
import type { EngineEvent, SignalSample, SignalStatus } from '../../engine/types';
import { QUESTION_BANK } from '../../content';
import type { BootInfo, SaveResult, SavedSessionSummary } from '../../shared/ipc';
import { ManualSignalSource } from '../../signals/ManualSignalSource';
import { parseRecording, recordToJson, type RecordingTap } from '../../signals/recording';
import { ReplaySignalSource } from '../../signals/ReplaySignalSource';
import { SimulatedSignalSource } from '../../signals/SimulatedSignalSource';
import type { InsightReply, SignalSource, Unsubscribe } from '../../signals/SignalSource';
import { loadRealSource } from './realSource';
import { Store } from './store';
import { InterviewerVoice } from './tts';

export interface SessionOptions {
  questionCount: number;
  cameraFree: boolean;
  insightsOptIn: boolean;
  telemetry: boolean;
}

export type AppScreen = 'consent' | 'session' | 'sessions' | 'saved';

export type InsightStatus = 'off' | 'unavailable' | 'pending' | 'requesting' | 'done' | 'error';

export interface AppState {
  boot: BootInfo | null;
  screen: AppScreen;
  starting: boolean;
  startError: string | null;
  sourceError: string | null;
  options: SessionOptions;
  cameraActive: boolean;
  savedList: SavedSessionSummary[];
  savedRecord: SessionRecord | null;
  sessionSaved: SaveResult | null;
  recordingSaved: SaveResult | null;
  insights: { status: InsightStatus; records: InsightRecord[]; message: string | null };
  canRecord: boolean;
  manualTalking: boolean;
}

export interface HudState {
  mode: 'real' | 'simulated' | 'replay' | 'camera-free' | 'idle';
  talking: boolean | null;
  breathingRate: number | null;
  breathingRateConfidence: number | null;
  pulseBpm: number | null;
  pulseConfidence: number | null;
  sdkConfidenceOk: boolean | null;
  status: SignalStatus | null;
  lastSampleAt: number | null;
}

const IDLE_HUD: HudState = {
  mode: 'idle',
  talking: null,
  breathingRate: null,
  breathingRateConfidence: null,
  pulseBpm: null,
  pulseConfidence: null,
  sdkConfidenceOk: null,
  status: null,
  lastSampleAt: null,
};

const DEFAULT_OPTIONS: SessionOptions = {
  questionCount: 4,
  cameraFree: false,
  insightsOptIn: false,
  telemetry: true,
};

const INSIGHT_TIMEOUT_MS = 25_000;

function newSessionId(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `session-${stamp}-${Math.floor(Math.random() * 1e4)
    .toString()
    .padStart(4, '0')}`;
}

export class SessionController {
  readonly app = new Store<AppState>({
    boot: null,
    screen: 'consent',
    starting: false,
    startError: null,
    sourceError: null,
    options: DEFAULT_OPTIONS,
    cameraActive: false,
    savedList: [],
    savedRecord: null,
    sessionSaved: null,
    recordingSaved: null,
    insights: { status: 'off', records: [], message: null },
    canRecord: false,
    manualTalking: false,
  });
  readonly hud = new Store<HudState>(IDLE_HUD);
  readonly engineStore = new Store<InterviewEngine | null>(null);
  readonly preview = new Store<MediaStream | null>(null);
  readonly voice = new InterviewerVoice();

  private config: EngineConfig = DEFAULT_CONFIG;
  private source: SignalSource | null = null;
  private tap: RecordingTap | null = null;
  private unsubs: Unsubscribe[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private hudPending: HudState | null = null;
  private hudTimer: ReturnType<typeof setTimeout> | null = null;
  private recordForSave: SessionRecord | null = null;

  async init(): Promise<void> {
    const bridge = window.composure;
    if (!bridge) {
      this.patch({ startError: 'The preload bridge is missing; restart the app.' });
      return;
    }
    const boot = await bridge.boot();
    this.config = mergeConfig(DEFAULT_CONFIG, boot.configOverride as DeepPartial<EngineConfig> | null);
    this.patch({ boot, canRecord: boot.recordSignals });
  }

  private patch(p: Partial<AppState>): void {
    this.app.update((s) => ({ ...s, ...p }));
  }

  get engine(): InterviewEngine | null {
    return this.engineStore.get();
  }

  setOptions(p: Partial<SessionOptions>): void {
    this.patch({ options: { ...this.app.get().options, ...p } });
  }

  // ------------------------------------------------------------ session

  async startSession(): Promise<void> {
    const state = this.app.get();
    const boot = state.boot;
    if (!boot || state.starting) return;
    const opts = state.options;
    this.patch({
      starting: true,
      startError: null,
      sourceError: null,
      sessionSaved: null,
      recordingSaved: null,
    });
    this.recordForSave = null;

    let source: SignalSource;
    try {
      source = await this.createSource(boot, opts);
    } catch (err) {
      this.patch({ starting: false, startError: err instanceof Error ? err.message : String(err) });
      return;
    }

    const seed = boot.mode === 'simulated' ? boot.sim.seed : Math.floor(Math.random() * 1e9);
    const questions = selectQuestions(QUESTION_BANK, opts.questionCount, seed);
    const engine = new InterviewEngine({
      questions,
      mode: opts.cameraFree ? 'camera-free' : source.kind,
      config: this.config,
    });

    this.source = source;
    this.unsubs.push(
      engine.on((e) => this.onEngineEvent(e)),
      source.onSample((s) => {
        engine.ingest(s);
        this.onHudSample(s);
      }),
      source.onStatus((st) => {
        engine.ingestStatus(st);
        this.queueHud({ ...(this.hudPending ?? this.hud.get()), status: st });
      }),
      source.onError((err) => {
        this.patch({ sourceError: err.message });
      }),
    );
    if (source.onPreviewStream)
      this.unsubs.push(source.onPreviewStream((stream) => this.preview.set(stream)));
    if (boot.recordSignals && !opts.cameraFree) this.tap = recordToJson(source);

    try {
      await source.start();
    } catch (err) {
      this.teardownSource();
      this.patch({ starting: false, startError: err instanceof Error ? err.message : String(err) });
      return;
    }

    this.hud.set({ ...IDLE_HUD, mode: opts.cameraFree ? 'camera-free' : source.kind });
    this.engineStore.set(engine);
    engine.begin(source.now());
    this.tickTimer = setInterval(() => {
      if (this.source) engine.tick(this.source.now());
    }, 100);
    this.patch({
      starting: false,
      screen: 'session',
      cameraActive: source.kind === 'real',
      insights: {
        status: opts.insightsOptIn ? (source.insights ? 'pending' : 'unavailable') : 'off',
        records: [],
        message: null,
      },
    });
  }

  private async createSource(boot: BootInfo, opts: SessionOptions): Promise<SignalSource> {
    if (opts.cameraFree) return new ManualSignalSource();
    if (boot.mode === 'simulated') {
      return new SimulatedSignalSource({
        seed: boot.sim.seed,
        scenario: boot.sim.scenario,
        speed: boot.sim.speed,
      });
    }
    if (boot.mode === 'replay') {
      const json = await window.composure?.readReplay();
      if (!json) throw new Error(`Could not read the replay file ${boot.replayFile ?? ''}`);
      return new ReplaySignalSource(parseRecording(json));
    }
    const apiKey = await window.composure?.getApiKey();
    if (!apiKey) throw new Error('Real mode needs PRESAGE_API_KEY in the environment.');
    return loadRealSource({ apiKey, telemetry: opts.telemetry });
  }

  private onEngineEvent(e: EngineEvent): void {
    this.source?.observeEngine?.(e);
    const engine = this.engine;
    if (e.type === 'speak' && engine) {
      const id = e.id;
      this.voice.speak(e.text, () => {
        if (this.source) engine.speechEnded(id, this.source.now());
      });
    }
    if (e.type === 'debriefReady') void this.onDebrief();
  }

  private onHudSample(s: SignalSample): void {
    const prev = this.hudPending ?? this.hud.get();
    this.queueHud({
      ...prev,
      talking: s.talking ?? null,
      breathingRate: s.breathingRate ?? null,
      breathingRateConfidence: s.breathingRateConfidence ?? null,
      pulseBpm: s.pulseBpm ?? null,
      pulseConfidence: s.pulseConfidence ?? null,
      sdkConfidenceOk: s.sdkConfidenceOk,
      lastSampleAt: s.tMs,
    });
  }

  /** HUD updates are coalesced to ~10 Hz. */
  private queueHud(next: HudState): void {
    this.hudPending = next;
    if (this.hudTimer) return;
    this.hudTimer = setTimeout(() => {
      this.hudTimer = null;
      if (this.hudPending) this.hud.set(this.hudPending);
      this.hudPending = null;
    }, 100);
  }

  private async onDebrief(): Promise<void> {
    const opts = this.app.get().options;
    this.tap?.stop();
    if (opts.insightsOptIn && this.source?.insights) {
      await this.requestInsight();
    }
    await this.stopSource();
  }

  private async requestInsight(): Promise<void> {
    const engine = this.engine;
    const channel = this.source?.insights;
    if (!engine || !channel) return;
    const record = engine.buildRecord({ id: 'pending', createdAt: new Date().toISOString(), appVersion: '' });
    const prompt = buildInsightPrompt(record);
    this.patch({ insights: { status: 'requesting', records: [], message: null } });
    try {
      const reply = await new Promise<InsightReply | null>((resolve) => {
        let requestId: number | null = null;
        const early: InsightReply[] = [];
        const off = channel.onReply((r) => {
          if (requestId === null) early.push(r);
          else if (r.requestId === requestId) {
            off();
            resolve(r);
          }
        });
        setTimeout(() => {
          off();
          resolve(null);
        }, INSIGHT_TIMEOUT_MS);
        channel
          .request(prompt)
          .then((id) => {
            requestId = id;
            const hit = early.find((r) => r.requestId === id);
            if (hit) {
              off();
              resolve(hit);
            }
          })
          .catch(() => {
            off();
            resolve(null);
          });
      });
      if (!reply) {
        this.patch({
          insights: { status: 'error', records: [], message: 'No summary arrived from the service.' },
        });
        return;
      }
      const rec: InsightRecord = {
        prompt,
        requestId: reply.requestId,
        processedAt: reply.processedAt,
        analysis: reply.analysis ? redactBannedTerms(reply.analysis) : null,
        error: reply.error ? redactBannedTerms(reply.error) : null,
      };
      this.patch({
        insights: { status: rec.analysis ? 'done' : 'error', records: [rec], message: rec.error },
      });
    } catch (err) {
      this.patch({
        insights: { status: 'error', records: [], message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  setManualTalking(talking: boolean): void {
    if (this.source instanceof ManualSignalSource) {
      this.source.setTalking(talking);
      this.patch({ manualTalking: talking });
    }
  }

  manualEndAnswer(): void {
    if (this.engine && this.source) this.engine.manualEndAnswer(this.source.now());
  }

  continueAfterGate(): void {
    if (this.engine && this.source) this.engine.continueAfterGate(this.source.now());
  }

  skipGate(): void {
    if (this.engine && this.source) this.engine.skipGate(this.source.now());
  }

  endSessionEarly(): void {
    if (this.engine && this.source) this.engine.endSession(this.source.now());
  }

  /** Back to the consent screen; releases everything. */
  async leaveSession(): Promise<void> {
    this.voice.cancel();
    await this.stopSource();
    this.teardownSource();
    this.engineStore.set(null);
    this.hud.set(IDLE_HUD);
    this.patch({
      screen: 'consent',
      sourceError: null,
      insights: { status: 'off', records: [], message: null },
    });
  }

  private async stopSource(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    const src = this.source;
    if (src) {
      try {
        await src.stop();
      } catch (err) {
        console.warn('[composure] source stop failed', err);
      }
    }
    this.preview.set(null);
    this.patch({ cameraActive: false });
  }

  private teardownSource(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.source = null;
    this.tap = null;
  }

  // ------------------------------------------------------------ saving

  /** Build (once) the record for the finished session. */
  currentRecord(): SessionRecord | null {
    const engine = this.engine;
    if (!engine) return null;
    if (!this.recordForSave) {
      const now = new Date();
      this.recordForSave = engine.buildRecord(
        {
          id: newSessionId(now),
          createdAt: now.toISOString(),
          appVersion: this.app.get().boot?.appVersion ?? '',
        },
        this.app.get().insights.records,
      );
    } else {
      this.recordForSave = { ...this.recordForSave, insights: this.app.get().insights.records };
    }
    return this.recordForSave;
  }

  async saveSession(): Promise<void> {
    const rec = this.currentRecord();
    if (!rec || !window.composure) return;
    const res = await window.composure.sessions.save(serializeSession(rec));
    this.patch({ sessionSaved: res });
  }

  async saveRecording(): Promise<void> {
    if (!this.tap || !window.composure) return;
    const res = await window.composure.saveRecording(
      this.tap.toJson(new Date().toISOString(), `mode=${this.source?.kind ?? 'unknown'}`),
    );
    this.patch({ recordingSaved: res });
  }

  async savePng(dataUrl: string, name: string): Promise<SaveResult | null> {
    if (!window.composure) return null;
    return window.composure.savePng(dataUrl, name);
  }

  // ------------------------------------------------------------ saved sessions

  async openSessions(): Promise<void> {
    const list = (await window.composure?.sessions.list()) ?? [];
    this.patch({ screen: 'sessions', savedList: list, savedRecord: null });
  }

  async viewSaved(id: string): Promise<void> {
    const json = await window.composure?.sessions.load(id);
    if (!json) return;
    try {
      this.patch({ screen: 'saved', savedRecord: parseSession(json) });
    } catch (err) {
      this.patch({ startError: err instanceof Error ? err.message : String(err) });
    }
  }

  async deleteSaved(id: string): Promise<void> {
    await window.composure?.sessions.delete(id);
    const list = (await window.composure?.sessions.list()) ?? [];
    this.patch({ savedList: list, savedRecord: null, screen: 'sessions' });
  }

  revealSessionsFolder(): void {
    void window.composure?.sessions.reveal();
  }

  backToStart(): void {
    this.patch({ screen: 'consent', savedRecord: null });
  }
}
