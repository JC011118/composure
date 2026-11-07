import { describe, expect, it } from 'vitest';
import { InterviewEngine } from '../src/engine/engine';
import { selectQuestions } from '../src/engine/questions';
import type { EngineEvent, SignalSample, SignalStatus } from '../src/engine/types';
import { QUESTION_BANK } from '../src/content';
import { SimulatedSignalSource } from '../src/signals/SimulatedSignalSource';
import { Emitter, type SignalSource, type SourceError } from '../src/signals/SignalSource';
import { defaultSpeechMs } from '../src/signals/headless';
import { parseRecording, recordToJson } from '../src/signals/recording';
import { replaySession } from '../src/signals/replaySession';
import { summarize } from '../src/signals/summary';
import { TEST_CONFIG } from './engine/testConfig';

/**
 * Emulates the real SDK path: samples are captured on time but delivered late,
 * in batches, while the app ticks the engine on its own clock every 100 ms
 * (like SessionController). A recording made this way must replay to the
 * identical debrief.
 */
class LatencySource implements SignalSource {
  readonly kind = 'real' as const;
  private readonly samples = new Emitter<SignalSample>();
  private readonly statuses = new Emitter<SignalStatus>();
  private readonly errors = new Emitter<SourceError>();
  private queue: SignalSample[] = [];
  private statusQueue: SignalStatus[] = [];
  private clock = 0;
  private delivered = Number.NEGATIVE_INFINITY;

  constructor(
    readonly inner: SimulatedSignalSource,
    private readonly latencyMs: number,
    private readonly batchMs: number,
  ) {
    inner.onSample((s) => this.queue.push(s));
    inner.onStatus((s) => this.statusQueue.push(s));
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  now(): number {
    return this.clock;
  }

  advance(clock: number): void {
    this.clock = clock;
    this.inner.stepTo(clock);
    const due = clock - this.latencyMs;
    if (due - this.delivered < this.batchMs) return;
    this.delivered = due;
    while (this.statusQueue.length && this.statusQueue[0].tMs <= due)
      this.statuses.emit(this.statusQueue.shift() as SignalStatus);
    while (this.queue.length && this.queue[0].tMs <= due)
      this.samples.emit(this.queue.shift() as SignalSample);
  }

  observeEngine(e: EngineEvent): void {
    this.inner.observeEngine(e);
  }
  onSample(l: (s: SignalSample) => void) {
    return this.samples.on(l);
  }
  onStatus(l: (s: SignalStatus) => void) {
    return this.statuses.on(l);
  }
  onError(l: (e: SourceError) => void) {
    return this.errors.on(l);
  }
}

function liveSession(seed: number, latencyMs: number, batchMs: number) {
  const questions = selectQuestions(QUESTION_BANK, 3, seed);
  const engine = new InterviewEngine({ questions, mode: 'real', config: TEST_CONFIG });
  const src = new LatencySource(new SimulatedSignalSource({ seed, scenario: 'demo' }), latencyMs, batchMs);
  const tap = recordToJson(src);
  tap.setSession(
    questions.map((q) => q.id),
    TEST_CONFIG,
  );
  const pending: { id: number; at: number }[] = [];
  engine.on((e) => {
    src.observeEngine(e);
    if (e.type === 'speak') pending.push({ id: e.id, at: e.tMs + defaultSpeechMs(e.text) });
  });
  src.onSample((s) => engine.ingest(s));
  src.onStatus((s) => engine.ingestStatus(s));
  tap.mark('begin', 0);
  engine.begin(0);
  for (let clock = 0; clock < 30 * 60_000 && engine.currentPhase !== 'debrief'; clock += 100) {
    src.advance(clock);
    tap.mark('tick', clock);
    engine.tick(clock);
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= clock) {
        const [{ id }] = pending.splice(i, 1);
        tap.mark('speechEnded', clock, id);
        engine.speechEnded(id, clock);
      }
    }
  }
  tap.stop();
  return { engine, json: tap.toJson('2026-11-07T00:00:00.000Z') };
}

describe('replay under SDK-like latency', () => {
  it.each([
    { seed: 3, latencyMs: 700, batchMs: 1_000 },
    { seed: 5, latencyMs: 1_000, batchMs: 1_000 },
    { seed: 8, latencyMs: 400, batchMs: 200 },
  ])(
    'seed $seed, latency $latencyMs ms, batches $batchMs ms: replay reproduces the live debrief',
    ({ seed, latencyMs, batchMs }) => {
      const { engine, json } = liveSession(seed, latencyMs, batchMs);
      expect(engine.currentPhase).toBe('debrief');
      const meta = { id: 'x', createdAt: '2026-11-07T00:00:00.000Z', appVersion: 't' };
      const live = summarize(engine.buildRecord(meta));
      const { run, record } = replaySession(parseRecording(json), QUESTION_BANK);
      expect(run.reachedDebrief).toBe(true);
      expect(summarize(record)).toEqual(live);
      expect(live.questions.length).toBe(3);
    },
  );
});
