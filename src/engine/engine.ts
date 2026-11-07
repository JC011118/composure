/**
 * InterviewEngine — the Composure state machine.
 *
 *   consent → signalCheck → baselineSeated (30 s, silent)
 *           → baselineTalking (30 s, reading aloud)
 *           → for each question: asking → listening → gate
 *           → debrief
 *
 * Camera-free mode skips the signal check and baselines and replaces the Gate
 * with a fixed paced pause.
 *
 * Time comes only from sample timestamps (`ingest`) and explicit `tick(tMs)`
 * calls — the engine never reads a clock. Outputs are events (`on`) and an
 * immutable snapshot for the UI (`subscribe` / `getSnapshot`).
 *
 * Pure module.
 */

import { BaselineAccumulator, type BaselineStats } from './baseline';
import { BreathCycleDetector, type CycleEstimate } from './breathCycles';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import { decideCueA, decideCueB } from './cues';
import { computeBand, GateDetector, type Band, type GateResult, type GateStatus } from './gate';
import { bucketSeries, silentSpans, timeWeighted, timeWeightedSpans } from './metrics';
import {
  NOT_ENOUGH_SIGNAL,
  type BreathingResult,
  type InsightRecord,
  type PulseResult,
  type QuestionResult,
  type SessionHrv,
  type SessionMeta,
  type SessionRecord,
} from './session';
import { mean } from './stats';
import { AnswerTracker, TalkDebouncer } from './talk';
import type {
  CueEvent,
  CueKind,
  EngineEvent,
  Phase,
  Question,
  SignalMode,
  SignalSample,
  SignalStatus,
  SpeechKind,
} from './types';

export interface EngineOptions {
  questions: readonly Question[];
  mode: SignalMode;
  config?: EngineConfig;
  /** How much recent signal to keep for live charts. */
  liveWindowMs?: number;
}

export interface EngineSnapshot {
  phase: Phase;
  phaseStartMs: number;
  nowMs: number;
  phaseElapsedMs: number;
  mode: SignalMode;
  cameraFree: boolean;
  questionIndex: number;
  questionCount: number;
  question: Question | null;
  interviewerLine: string | null;
  speaking: SpeechKind | null;
  signalCheck: { okMs: number; neededMs: number; maxMs: number } | null;
  baseline: { kind: 'seated' | 'talking'; elapsedMs: number; targetMs: number; coverage: number } | null;
  listening: {
    answerStarted: boolean;
    talking: boolean;
    silenceMs: number | null;
    answerElapsedMs: number | null;
    armed: boolean;
    cues: CueKind[];
  } | null;
  gate: {
    status: GateStatus | null;
    band: Band | null;
    result: GateResult | null;
    paced: boolean;
    pacedRemainingMs: number | null;
    dwellRemainingMs: number | null;
  } | null;
  seated: BaselineStats | null;
  talking: BaselineStats | null;
  band: Band | null;
  results: readonly QuestionResult[];
  hrv: SessionHrv | null;
  lastStatus: SignalStatus | null;
  /** Debounced talking right now (any phase). */
  talkingNow: boolean;
  notes: readonly string[];
}

interface Speaking {
  id: number;
  kind: SpeechKind;
  text: string;
  startedMs: number;
  fallbackEndMs: number;
}

interface QuestionState {
  index: number;
  question: Question;
  askStartMs: number;
  speechId: number;
  listenStartMs: number | null;
  tracker: AnswerTracker | null;
  gateStartMs: number | null;
  gate: GateDetector | null;
  gateResult: GateResult | null;
  dwellUntilMs: number | null;
  samples: SignalSample[];
}

const SNAPSHOT_INTERVAL_MS = 100;
/**
 * Real SDK packets arrive a little after the moment they describe, while the
 * app ticks on the wall clock. Listening decisions (end of answer, cues) use
 * sample time while samples are flowing and fall back to the clock only when
 * samples have stalled for this long.
 */
const SAMPLE_STALL_MS = 1_500;
/** A pulse delta needs at least this much answer to average over. */
const MIN_PULSE_SPAN_MS = 2_000;

export class InterviewEngine {
  readonly config: EngineConfig;
  readonly questions: readonly Question[];
  readonly mode: SignalMode;
  readonly cameraFree: boolean;

  private phase: Phase = 'consent';
  private phaseStartMs = 0;
  private nowMs = 0;
  private lastSampleMs = Number.NEGATIVE_INFINITY;
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly snapListeners = new Set<() => void>();
  private snapshot: EngineSnapshot;
  private lastSnapMs = Number.NEGATIVE_INFINITY;

  private nextSpeechId = 1;
  private speaking: Speaking | null = null;
  private interviewerLine: string | null = null;

  private readonly debouncer: TalkDebouncer;
  private readonly cycles: BreathCycleDetector;
  private recentEstimates: CycleEstimate[] = [];
  private lookback: SignalSample[] = [];
  private live: SignalSample[] = [];
  private readonly liveWindowMs: number;

  private signalCheckOkMs = 0;
  private signalCheckLastT: number | null = null;
  private signalCheckResult: { durationMs: number; timedOut: boolean } | null = null;
  private seatedAcc: BaselineAccumulator | null = null;
  private talkingAcc: BaselineAccumulator | null = null;
  private phaseTargetMs = 0;
  private extendedMs = 0;
  private seated: BaselineStats | null = null;
  private talking: BaselineStats | null = null;
  private band: Band | null = null;

  private q: QuestionState | null = null;
  private results: QuestionResult[] = [];
  private hrvLatest: SessionHrv | null = null;
  private hrvLatestStable: SessionHrv | null = null;
  private lastStatus: SignalStatus | null = null;
  private readonly notes: string[] = [];

  constructor(opts: EngineOptions) {
    if (opts.questions.length === 0) throw new Error('InterviewEngine needs at least one question');
    this.config = opts.config ?? DEFAULT_CONFIG;
    this.questions = opts.questions;
    this.mode = opts.mode;
    this.cameraFree = opts.mode === 'camera-free';
    this.liveWindowMs = opts.liveWindowMs ?? 30_000;
    this.debouncer = new TalkDebouncer(
      this.config.listening.talkOnDebounceMs,
      this.config.listening.talkOffDebounceMs,
    );
    this.cycles = new BreathCycleDetector(this.config.cycles);
    this.snapshot = this.buildSnapshot();
  }

  // ------------------------------------------------------------------ API

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribe(listener: () => void): () => void {
    this.snapListeners.add(listener);
    return () => this.snapListeners.delete(listener);
  }

  getSnapshot = (): EngineSnapshot => this.snapshot;

  /** Rebuild and return the snapshot immediately (tests, final reads). */
  snapshotNow(): EngineSnapshot {
    this.notify(true);
    return this.snapshot;
  }

  /** Recent samples (last `liveWindowMs`) for live charts. Do not mutate. */
  getLiveSamples(): readonly SignalSample[] {
    return this.live;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  get now(): number {
    return this.nowMs;
  }

  /** The user gave consent: start the session at time tMs. */
  begin(tMs: number): void {
    if (this.phase !== 'consent') return;
    this.nowMs = Math.max(this.nowMs, tMs);
    if (this.cameraFree) {
      this.startQuestion(0, this.nowMs);
    } else {
      this.setPhase('signalCheck', this.nowMs, -1);
      this.signalCheckOkMs = 0;
      this.signalCheckLastT = null;
    }
    this.notify(true);
  }

  ingest(sample: SignalSample): void {
    const t = sample.tMs;
    if (!Number.isFinite(t) || t < this.lastSampleMs) return;
    this.lastSampleMs = t;

    this.pushLive(sample);
    if (sample.hrv && sample.sdkConfidenceOk) {
      const h: SessionHrv = {
        rmssd: sample.hrv.rmssd,
        sdnn: sample.hrv.sdnn,
        meanNn: sample.hrv.meanNn,
        confidence: sample.hrv.confidence,
        stable: sample.hrv.stable,
        tMs: t,
      };
      this.hrvLatest = h;
      if (h.stable) this.hrvLatestStable = h;
    }

    // Breath cycles (global, for baselines and cue A).
    const est = this.cycles.push(t, sample.breathingTrace, sample.sdkConfidenceOk);
    if (est) {
      this.recentEstimates.push(est);
      if (this.recentEstimates.length > 64) this.recentEstimates.splice(0, this.recentEstimates.length - 64);
      if (this.phase === 'baselineSeated') this.seatedAcc?.addEstimate(est);
    }

    // Talking.
    const edge = this.debouncer.push(t, sample.talking);
    if (edge && this.phase === 'listening' && this.q?.tracker) {
      const tracker = this.q.tracker;
      const before = tracker.answerStarted;
      tracker.onEdge(edge);
      if (!before && tracker.answerStarted) {
        this.emit({
          type: 'answerStarted',
          questionIndex: this.q.index,
          tMs: tracker.answerStartMs as number,
        });
      }
      this.notify(true);
    }

    // Phase-specific accumulation.
    if (this.phase === 'signalCheck') {
      const dt = this.signalCheckLastT === null ? 0 : Math.min(200, t - this.signalCheckLastT);
      this.signalCheckLastT = t;
      if (sample.sdkConfidenceOk) this.signalCheckOkMs += dt;
    } else if (this.phase === 'baselineSeated') {
      this.seatedAcc?.addSample(sample);
    } else if (this.phase === 'baselineTalking') {
      this.talkingAcc?.addSample(sample);
    }
    if (this.q && (this.phase === 'asking' || this.phase === 'listening' || this.phase === 'gate')) {
      if (!this.q.gateResult) this.q.samples.push(sample);
      if (this.phase === 'gate' && this.q.gate && !this.q.gateResult) this.q.gate.push(sample);
    }

    this.advance(t);
  }

  ingestStatus(status: SignalStatus): void {
    this.lastStatus = status;
    this.notify(true);
  }

  /** Advance time without a sample (keeps timers running if the signal stalls). */
  tick(tMs: number): void {
    // The Gate only hears about clock time when samples have actually stalled;
    // normal SDK latency must not reset its streak.
    if (
      this.phase === 'gate' &&
      this.q?.gate &&
      !this.q.gateResult &&
      tMs - Math.max(this.lastSampleMs, this.q.gateStartMs ?? tMs) > this.config.gate.stallMs
    ) {
      this.q.gate.tick(tMs);
    }
    this.advance(tMs);
  }

  /** The UI's speech synthesizer finished an utterance. */
  speechEnded(id: number, tMs: number): void {
    this.nowMs = Math.max(this.nowMs, tMs);
    if (!this.speaking || this.speaking.id !== id) return;
    const kind = this.speaking.kind;
    this.speaking = null;
    if (kind === 'question' && this.phase === 'asking') this.enterListening(this.nowMs);
    this.notify(true);
  }

  /** User pressed "Done" (or Enter): close the answer now. */
  manualEndAnswer(tMs: number): void {
    this.nowMs = Math.max(this.nowMs, tMs);
    if (this.phase === 'asking' && this.q) {
      // During the question this only skips the rest of the question audio.
      this.speaking = null;
      this.enterListening(this.nowMs);
    } else if (this.phase === 'listening' && this.q?.tracker) {
      const end = this.q.tracker.end(this.nowMs, 'manual');
      this.enterGate(end.tMs, end.reason);
    }
    this.notify(true);
  }

  /** Skip the remaining "Recovered" card time and go to the next question. */
  continueAfterGate(tMs: number): void {
    this.nowMs = Math.max(this.nowMs, tMs);
    if (this.phase === 'gate' && this.q?.gateResult) {
      this.q.dwellUntilMs = this.nowMs;
      this.advance(this.nowMs);
    }
  }

  /** End the Gate without waiting (recorded as "skipped"). */
  skipGate(tMs: number): void {
    this.nowMs = Math.max(this.nowMs, tMs);
    if (this.phase !== 'gate' || !this.q || this.q.gateResult) return;
    if (this.q.gate) {
      this.completeGate(this.q.gate.skip(this.nowMs));
    } else {
      this.completeGate(this.makeResult(this.q.gateStartMs ?? this.nowMs, this.nowMs, 'skipped'));
    }
  }

  /** The user ended the session early: go to the debrief with the questions completed so far. */
  endSession(tMs: number): void {
    this.nowMs = Math.max(this.nowMs, tMs);
    if (this.phase === 'consent' || this.phase === 'debrief') return;
    if (this.questions.length > this.results.length) {
      this.notes.push(
        `Session ended early after ${this.results.length} of ${this.questions.length} questions.`,
      );
    }
    this.speaking = null;
    this.enterDebrief(this.nowMs);
  }

  buildRecord(meta: SessionMeta, insights: InsightRecord[] = []): SessionRecord {
    return {
      format: 'composure-session',
      version: 1,
      id: meta.id,
      createdAt: meta.createdAt,
      mode: this.mode,
      appVersion: meta.appVersion,
      config: this.config,
      signalCheck: this.signalCheckResult,
      baselines: { seated: this.seated, talking: this.talking, band: this.band },
      questions: [...this.results],
      hrv: this.sessionHrv(),
      insights,
      notes: [...this.notes],
    };
  }

  // ------------------------------------------------------------- internals

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  private notify(force: boolean): void {
    if (!force && this.nowMs - this.lastSnapMs < SNAPSHOT_INTERVAL_MS) return;
    this.lastSnapMs = this.nowMs;
    this.snapshot = this.buildSnapshot();
    for (const l of this.snapListeners) l();
  }

  private pushLive(s: SignalSample): void {
    this.live.push(s);
    const cutoff = s.tMs - this.liveWindowMs;
    if (this.live.length > 64 && this.live[0].tMs < cutoff - 5_000) {
      let i = 0;
      while (i < this.live.length && this.live[i].tMs < cutoff) i++;
      this.live = this.live.slice(i);
    }
    this.lookback.push(s);
    const lbCut = s.tMs - this.config.gate.lookbackMs;
    if (this.lookback.length > 64 && this.lookback[0].tMs < lbCut - 2_000) {
      let i = 0;
      while (i < this.lookback.length && this.lookback[i].tMs < lbCut) i++;
      this.lookback = this.lookback.slice(i);
    }
  }

  private setPhase(phase: Phase, tMs: number, questionIndex: number): void {
    this.phase = phase;
    this.phaseStartMs = tMs;
    this.emit({ type: 'phase', phase, questionIndex, tMs });
  }

  private speak(text: string, kind: SpeechKind, tMs: number): number {
    const id = this.nextSpeechId++;
    const words = text.split(/\s+/).filter(Boolean).length;
    const { msPerWord, minMs, fallbackSlackMs } = this.config.asking;
    this.speaking = {
      id,
      kind,
      text,
      startedMs: tMs,
      fallbackEndMs: tMs + Math.max(minMs, words * msPerWord) + fallbackSlackMs,
    };
    this.interviewerLine = text;
    this.emit({ type: 'speak', id, text, kind, tMs });
    return id;
  }

  private advance(t: number): void {
    if (t > this.nowMs) this.nowMs = t;
    const now = this.nowMs;
    // Speech that never reported an end (TTS unavailable) expires on its own.
    if (this.speaking && now >= this.speaking.fallbackEndMs) {
      const kind = this.speaking.kind;
      this.speaking = null;
      if (kind === 'question' && this.phase === 'asking') this.enterListening(now);
    }

    switch (this.phase) {
      case 'signalCheck': {
        const { minOkMs, maxMs } = this.config.signalCheck;
        if (this.signalCheckOkMs >= minOkMs) this.enterSeated(now, false);
        else if (now - this.phaseStartMs >= maxMs) this.enterSeated(now, true);
        break;
      }
      case 'baselineSeated':
      case 'baselineTalking': {
        const acc = this.phase === 'baselineSeated' ? this.seatedAcc : this.talkingAcc;
        if (!acc || now - this.phaseStartMs < this.phaseTargetMs) break;
        const b = this.config.baseline;
        if (acc.coverage(now) < b.minValidCoverage && this.extendedMs < b.maxExtendMs) {
          this.phaseTargetMs += b.extendStepMs;
          this.extendedMs += b.extendStepMs;
          this.notify(true);
          break;
        }
        if (this.phase === 'baselineSeated') this.finishSeated(now);
        else this.finishTalking(now);
        break;
      }
      case 'listening': {
        const stalled = now - this.lastSampleMs > SAMPLE_STALL_MS;
        this.updateListening(stalled ? now : Math.max(this.lastSampleMs, this.phaseStartMs));
        break;
      }
      case 'gate':
        this.updateGate(now);
        break;
      default:
        break;
    }
    this.notify(false);
  }

  private enterSeated(t: number, timedOut: boolean): void {
    this.signalCheckResult = { durationMs: t - this.phaseStartMs, timedOut };
    if (timedOut) this.notes.push('The signal check timed out; the baseline started without a clean signal.');
    this.seatedAcc = new BaselineAccumulator('seated', t, this.config.baseline, this.config.debrief);
    this.phaseTargetMs = this.config.baseline.seatedMs;
    this.extendedMs = 0;
    this.setPhase('baselineSeated', t, -1);
    this.notify(true);
  }

  private finishSeated(t: number): void {
    this.seated = (this.seatedAcc as BaselineAccumulator).finish(t);
    this.band = computeBand(this.seated.breath, this.config.gate, this.config.baseline);
    this.notes.push(...this.seated.notes.map((n) => `Seated baseline: ${n}`));
    this.talkingAcc = new BaselineAccumulator('talking', t, this.config.baseline, this.config.debrief);
    this.phaseTargetMs = this.config.baseline.talkingMs;
    this.extendedMs = 0;
    this.setPhase('baselineTalking', t, -1);
    this.notify(true);
  }

  private finishTalking(t: number): void {
    this.talking = (this.talkingAcc as BaselineAccumulator).finish(t);
    this.notes.push(...this.talking.notes.map((n) => `Talking baseline: ${n}`));
    this.startQuestion(0, t);
  }

  private startQuestion(index: number, t: number): void {
    const question = this.questions[index];
    this.setPhase('asking', t, index);
    const speechId = this.speak(question.text, 'question', t);
    this.q = {
      index,
      question,
      askStartMs: t,
      speechId,
      listenStartMs: null,
      tracker: null,
      gateStartMs: null,
      gate: null,
      gateResult: null,
      dwellUntilMs: null,
      samples: [],
    };
    this.notify(true);
  }

  private enterListening(t: number): void {
    if (!this.q || this.phase !== 'asking') return;
    this.q.listenStartMs = t;
    // Only an utterance still in progress counts as the answer having started.
    this.q.tracker = new AnswerTracker(
      this.config.listening,
      t,
      this.debouncer.talking && this.debouncer.rawTalking,
    );
    this.setPhase('listening', t, this.q.index);
    if (this.q.tracker.answerStarted) {
      this.emit({ type: 'answerStarted', questionIndex: this.q.index, tMs: t });
    }
    this.notify(true);
  }

  private updateListening(t: number): void {
    const q = this.q;
    const tr = q?.tracker;
    if (!q || !tr) return;
    // Cue B: long answer, still talking.
    if (
      decideCueB(
        {
          answerElapsedMs: tr.answerElapsedMs(t),
          talking: tr.talking,
          ended: tr.ended !== null,
          alreadyFired: tr.hasCue('B'),
        },
        this.config.cueB,
      )
    ) {
      this.fireCue(
        { cue: 'B', tMs: t, answerElapsedMs: tr.answerElapsedMs(t) ?? undefined },
        this.config.cueB.text,
      );
    }

    // Cue A: long mid-answer silence, confirmed by breathing rate over that silence.
    const silenceMs = tr.silenceMs(t);
    if (
      tr.answerStarted &&
      !tr.hasCue('A') &&
      silenceMs !== null &&
      silenceMs > this.config.cueA.silenceMs &&
      tr.lastTalkEndMs !== null
    ) {
      const from = tr.lastTalkEndMs;
      const sdk = timeWeighted(
        q.samples,
        from,
        t,
        (s) => (s.sdkConfidenceOk ? s.breathingRate : undefined),
        this.config.debrief.maxSampleGapMs,
      );
      // Only breaths that lie entirely inside the silence (not ones that began during speech).
      const inSpan = this.recentEstimates.filter((e) => e.pointMs - e.periodMs >= from && e.pointMs <= t);
      const traceRate = inSpan.length >= 2 ? 60_000 / (mean(inSpan.map((e) => e.periodMs)) as number) : null;
      const decision = decideCueA(
        {
          answerStarted: tr.answerStarted,
          ended: tr.ended !== null,
          alreadyFired: false,
          talking: tr.talking,
          silenceMs,
          seatedRate: this.seatedRateForCues(),
          sdkRateMean: sdk.mean,
          sdkRateCoveredMs: sdk.coveredMs,
          traceRate,
        },
        this.config.cueA,
      );
      if (decision.fire) {
        this.fireCue(
          {
            cue: 'A',
            tMs: t,
            silenceMs,
            breathingRateOverSpan: decision.rate ?? undefined,
            rateBandUpper: decision.upper ?? undefined,
          },
          this.config.cueA.text,
        );
      }
    }

    const end = tr.check(t);
    if (end) this.enterGate(end.tMs, end.reason);
  }

  /** Seated breathing-rate stats for cue A; derived from the seated breath period if the SDK rate is missing. */
  private seatedRateForCues(): { mean: number; sd: number; n: number } | null {
    if (this.seated?.breathingRate) return this.seated.breathingRate;
    const b = this.seated?.breath;
    if (!b || b.nEstimates < 2) return null;
    const m = 60_000 / b.periodMeanMs;
    return { mean: m, sd: (m * b.periodSdMs) / b.periodMeanMs, n: b.nEstimates };
  }

  private estimateSpeechMs(text: string): number {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(this.config.asking.minMs, words * this.config.asking.msPerWord);
  }

  private fireCue(event: CueEvent, text: string): void {
    const q = this.q;
    if (!q?.tracker) return;
    // Silence is not counted toward ending the answer until the user has had
    // time to respond to the cue.
    const floor =
      event.cue === 'A'
        ? event.tMs + this.config.cueA.graceMs
        : event.tMs + this.estimateSpeechMs(text) + this.config.cueB.graceMs;
    q.tracker.recordCue(event, floor);
    this.emit({ type: 'cue', questionIndex: q.index, event });
    this.speak(text, event.cue === 'A' ? 'cueA' : 'cueB', event.tMs);
    this.notify(true);
  }

  private enterGate(t: number, reason: QuestionResult['endReason']): void {
    const q = this.q;
    if (!q || this.phase !== 'listening') return;
    this.emit({ type: 'answerEnded', questionIndex: q.index, tMs: t, reason });
    q.gateStartMs = t;
    if (!this.cameraFree) {
      const band = this.band ?? computeBand(null, this.config.gate, this.config.baseline);
      q.gate = new GateDetector(band, this.config.gate, this.config.cycles, t);
      q.gate.seed(this.lookback);
    }
    this.setPhase('gate', t, q.index);
    this.notify(true);
  }

  private updateGate(t: number): void {
    const q = this.q;
    if (!q || q.gateStartMs === null) return;
    if (!q.gateResult) {
      if (this.cameraFree) {
        if (t - q.gateStartMs >= this.config.cameraFree.pauseMs) {
          this.completeGate(this.makeResult(q.gateStartMs, t, 'paced pause'));
        }
      } else if (q.gate?.result) {
        this.completeGate(q.gate.result);
      }
      return;
    }
    if (q.dwellUntilMs !== null && t >= q.dwellUntilMs) {
      const next = q.index + 1;
      if (next < this.questions.length) this.startQuestion(next, t);
      else this.enterDebrief(t);
    }
  }

  private makeResult(startMs: number, endMs: number, outcome: GateResult['outcome']): GateResult {
    return { startMs, endMs, outcome, timedOut: false, recoveryTimeMs: null, inBandFraction: 0 };
  }

  private completeGate(result: GateResult): void {
    const q = this.q;
    if (!q || q.gateResult) return;
    q.gateResult = result;
    q.dwellUntilMs = result.endMs + this.config.gate.postUnlockDwellMs;
    this.results = [...this.results, this.finalizeQuestion(q, result)];
    this.emit({
      type: 'gateUnlocked',
      questionIndex: q.index,
      tMs: result.endMs,
      timedOut: result.timedOut,
      recoveryTimeMs: result.recoveryTimeMs,
    });
    this.notify(true);
  }

  private enterDebrief(t: number): void {
    this.setPhase('debrief', t, this.questions.length - 1);
    this.q = null;
    this.speak("That's the last question. Here is your debrief.", 'outro', t);
    this.emit({ type: 'debriefReady', tMs: t });
    this.notify(true);
  }

  private sessionHrv(): SessionHrv | null {
    return this.hrvLatestStable ?? this.hrvLatest;
  }

  private finalizeQuestion(q: QuestionState, gate: GateResult): QuestionResult {
    const cfg = this.config;
    const tr = q.tracker as AnswerTracker;
    const listenStart = q.listenStartMs ?? q.askStartMs;
    const listenEnd = tr.ended?.tMs ?? gate.startMs;
    const answerStart = tr.answerStartMs;
    const answerEnd = tr.answerEndMs;
    const pauses = tr.pauses();
    const gap = cfg.debrief.maxSampleGapMs;

    // Pulse vs TALKING baseline, only with enough clean coverage of the answer.
    let pulse: PulseResult;
    if (this.cameraFree) {
      pulse = { deltaBpm: null, meanBpm: null, coverage: 0, shown: false, reason: 'camera off' };
    } else if (answerStart === null) {
      pulse = { deltaBpm: null, meanBpm: null, coverage: 0, shown: false, reason: 'no answer detected' };
    } else if ((answerEnd ?? listenEnd) - answerStart < MIN_PULSE_SPAN_MS) {
      pulse = { deltaBpm: null, meanBpm: null, coverage: 0, shown: false, reason: NOT_ENOUGH_SIGNAL };
    } else {
      const to = answerEnd ?? listenEnd;
      const st = timeWeighted(
        q.samples,
        answerStart,
        to,
        (s) =>
          s.sdkConfidenceOk &&
          s.pulseBpm !== undefined &&
          (s.pulseConfidence ?? 0) >= cfg.debrief.pulseConfidenceMin
            ? s.pulseBpm
            : undefined,
        gap,
      );
      const base = this.talking?.pulse ?? null;
      const shown = st.mean !== null && base !== null && st.coverage >= cfg.debrief.pulseCoverageMin;
      pulse = {
        deltaBpm: shown ? (st.mean as number) - (base as { mean: number }).mean : null,
        meanBpm: shown ? st.mean : null,
        coverage: st.coverage,
        shown,
        reason: shown ? null : NOT_ENOUGH_SIGNAL,
      };
    }

    // Breathing rate over silent spans only, vs SEATED baseline.
    let breathing: BreathingResult;
    if (this.cameraFree) {
      breathing = {
        deltaBrPerMin: null,
        meanBrPerMin: null,
        silentCoveredMs: 0,
        shown: false,
        reason: 'camera off',
      };
    } else {
      const spans = silentSpans(tr.segments, listenStart, listenEnd, cfg.debrief.minSilentSpanMs);
      const st = timeWeightedSpans(
        q.samples,
        spans,
        (s) => (s.sdkConfidenceOk ? s.breathingRate : undefined),
        gap,
      );
      const base = this.seated?.breathingRate ?? null;
      const shown = st.mean !== null && base !== null && st.coveredMs >= cfg.debrief.minBreathingSilentMs;
      breathing = {
        deltaBrPerMin: shown ? (st.mean as number) - (base as { mean: number }).mean : null,
        meanBrPerMin: shown ? st.mean : null,
        silentCoveredMs: st.coveredMs,
        shown,
        reason: shown ? null : NOT_ENOUGH_SIGNAL,
      };
    }

    const from = q.askStartMs;
    const to = gate.endMs;
    const minPulseConf = cfg.debrief.pulseConfidenceMin;
    const series = {
      startMs: from,
      trace: bucketSeries(
        q.samples,
        from,
        to,
        cfg.debrief.traceSeriesHz,
        (s) => (s.sdkConfidenceOk ? s.breathingTrace : undefined),
        4,
      ),
      pulse: bucketSeries(
        q.samples,
        from,
        to,
        cfg.debrief.slowSeriesHz,
        (s) => (s.sdkConfidenceOk && (s.pulseConfidence ?? 0) >= minPulseConf ? s.pulseBpm : undefined),
        1,
      ),
      breathingRate: bucketSeries(
        q.samples,
        from,
        to,
        cfg.debrief.slowSeriesHz,
        (s) => (s.sdkConfidenceOk ? s.breathingRate : undefined),
        2,
      ),
      talk: tr.segments.map((s) => ({ startMs: s.startMs - from, endMs: s.endMs - from })),
      marks: { listenMs: listenStart - from, gateMs: gate.startMs - from, endMs: to - from },
    };

    return {
      index: q.index,
      questionId: q.question.id,
      text: q.question.text,
      tag: q.question.tag,
      askStartMs: q.askStartMs,
      listenStartMs: listenStart,
      answerStartMs: answerStart,
      answerEndMs: answerEnd,
      listenEndMs: listenEnd,
      endReason: tr.ended?.reason ?? 'manual',
      timeToFirstWordMs: answerStart === null ? null : answerStart - listenStart,
      talkTimeMs: tr.talkTimeMs(),
      pauseCount: pauses.length,
      pausesMs: pauses,
      cues: [...tr.cues],
      gate,
      recovery: gate.outcome,
      recoveryTimeMs: gate.recoveryTimeMs,
      pulse,
      breathing,
      series,
    };
  }

  private buildSnapshot(): EngineSnapshot {
    const q = this.q;
    const tr = q?.tracker ?? null;
    const now = this.nowMs;
    const inBaseline = this.phase === 'baselineSeated' || this.phase === 'baselineTalking';
    const acc = this.phase === 'baselineSeated' ? this.seatedAcc : this.talkingAcc;
    return {
      phase: this.phase,
      phaseStartMs: this.phaseStartMs,
      nowMs: now,
      phaseElapsedMs: Math.max(0, now - this.phaseStartMs),
      mode: this.mode,
      cameraFree: this.cameraFree,
      questionIndex: q?.index ?? (this.phase === 'debrief' ? this.questions.length - 1 : -1),
      questionCount: this.questions.length,
      question: q?.question ?? null,
      interviewerLine: this.interviewerLine,
      speaking: this.speaking?.kind ?? null,
      signalCheck:
        this.phase === 'signalCheck'
          ? {
              okMs: this.signalCheckOkMs,
              neededMs: this.config.signalCheck.minOkMs,
              maxMs: this.config.signalCheck.maxMs,
            }
          : null,
      baseline:
        inBaseline && acc
          ? {
              kind: this.phase === 'baselineSeated' ? 'seated' : 'talking',
              elapsedMs: now - this.phaseStartMs,
              targetMs: this.phaseTargetMs,
              coverage: acc.coverage(now),
            }
          : null,
      listening:
        this.phase === 'listening' && tr
          ? {
              answerStarted: tr.answerStarted,
              talking: tr.talking,
              silenceMs: tr.silenceMs(now),
              answerElapsedMs: tr.answerElapsedMs(now),
              armed: tr.armed(now),
              cues: tr.cues.map((c) => c.cue),
            }
          : null,
      gate:
        this.phase === 'gate' && q
          ? {
              status: q.gate?.status ?? null,
              band: q.gate?.band ?? null,
              result: q.gateResult,
              paced: this.cameraFree,
              pacedRemainingMs:
                this.cameraFree && q.gateStartMs !== null && !q.gateResult
                  ? Math.max(0, this.config.cameraFree.pauseMs - (now - q.gateStartMs))
                  : null,
              dwellRemainingMs: q.dwellUntilMs !== null ? Math.max(0, q.dwellUntilMs - now) : null,
            }
          : null,
      seated: this.seated,
      talking: this.talking,
      band: this.band,
      results: this.results,
      hrv: this.sessionHrv(),
      lastStatus: this.lastStatus,
      talkingNow: this.debouncer.talking,
      notes: this.notes,
    };
  }
}
