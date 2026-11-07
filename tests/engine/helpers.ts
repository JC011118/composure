import { InterviewEngine } from '../../src/engine/engine';
import { DEFAULT_CONFIG, mergeConfig, type DeepPartial, type EngineConfig } from '../../src/engine/config';
import { gaussian, mulberry32 } from '../../src/engine/stats';
import type { EngineEvent, Question, SignalMode, SignalSample } from '../../src/engine/types';

export interface TraceSpec {
  periodMs: number | ((t: number) => number);
  /** Sinusoid amplitude (peak-to-trough is 2×). */
  amp: number | ((t: number) => number);
  noise?: number;
  seed?: number;
  drift?: number;
}

/** Phase-continuous synthetic breathing trace generator. */
export function traceGen(spec: TraceSpec) {
  const rand = mulberry32(spec.seed ?? 1);
  let phase = 0;
  let lastT: number | null = null;
  return (t: number): number => {
    const p = typeof spec.periodMs === 'function' ? spec.periodMs(t) : spec.periodMs;
    const a = typeof spec.amp === 'function' ? spec.amp(t) : spec.amp;
    if (lastT !== null) phase += (2 * Math.PI * (t - lastT)) / p;
    lastT = t;
    return (
      a * Math.sin(phase) +
      (spec.drift ?? 0) * Math.sin((2 * Math.PI * t) / 40_000) +
      (spec.noise ?? 0) * gaussian(rand)
    );
  };
}

export function synthSamples(
  fromMs: number,
  toMs: number,
  trace: (t: number) => number,
  extra: (t: number) => Partial<SignalSample> = () => ({}),
  hz = 30,
): SignalSample[] {
  const out: SignalSample[] = [];
  const step = 1000 / hz;
  for (let t = fromMs; t < toMs; t += step) {
    const tt = Math.round(t * 1000) / 1000;
    out.push({ tMs: tt, breathingTrace: trace(tt), sdkConfidenceOk: true, ...extra(tt) });
  }
  return out;
}

export const Q = (n: number): Question[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    text: `Question number ${i + 1} please answer it.`,
    tag: i % 2 === 0 ? 'behavioral' : 'technical',
    difficulty: 2,
  }));

export interface Ctx {
  phase: string;
  /** ms since the current phase started. */
  since: number;
  questionIndex: number;
}

export interface Script {
  trace?: (t: number, c: Ctx) => number;
  talking?: (t: number, c: Ctx) => boolean;
  rate?: (t: number, c: Ctx) => number | undefined;
  rateConf?: (t: number, c: Ctx) => number;
  pulse?: (t: number, c: Ctx) => number | undefined;
  pulseConf?: (t: number, c: Ctx) => number;
  ok?: (t: number, c: Ctx) => boolean;
}

/**
 * Drives an engine with a time-scripted signal at 30 Hz. Speech ends after
 * `speechMs` unless `manualSpeech` is set.
 */
export class ScriptedRun {
  readonly engine: InterviewEngine;
  readonly events: EngineEvent[] = [];
  t = 0;
  private pending: { id: number; at: number }[] = [];
  script: Script;
  speechMs = 2_000;
  manualSpeech = false;
  phase = 'consent';
  phaseStart = 0;
  questionIndex = -1;

  constructor(
    script: Script,
    opts: { questions?: number; mode?: SignalMode; config?: DeepPartial<EngineConfig> } = {},
  ) {
    this.script = script;
    this.engine = new InterviewEngine({
      questions: Q(opts.questions ?? 2),
      mode: opts.mode ?? 'simulated',
      config: mergeConfig(DEFAULT_CONFIG, opts.config ?? {}),
    });
    this.engine.on((e) => {
      this.events.push(e);
      if (e.type === 'phase') {
        this.phase = e.phase;
        this.phaseStart = e.tMs;
        this.questionIndex = e.questionIndex;
      }
      if (e.type === 'speak' && !this.manualSpeech)
        this.pending.push({ id: e.id, at: e.tMs + this.speechMs });
    });
  }

  sampleAt(t: number): SignalSample {
    const s = this.script;
    const c: Ctx = { phase: this.phase, since: t - this.phaseStart, questionIndex: this.questionIndex };
    const ok = s.ok ? s.ok(t, c) : true;
    const sample: SignalSample = { tMs: t, sdkConfidenceOk: ok };
    sample.breathingTrace = s.trace ? s.trace(t, c) : Math.sin((2 * Math.PI * t) / 4_000);
    sample.talking = s.talking ? s.talking(t, c) : false;
    if (ok) {
      const r = s.rate ? s.rate(t, c) : 14;
      if (r !== undefined) {
        sample.breathingRate = r;
        sample.breathingRateConfidence = s.rateConf ? s.rateConf(t, c) : 80;
      }
      const p = s.pulse ? s.pulse(t, c) : 70;
      if (p !== undefined) {
        sample.pulseBpm = p;
        sample.pulseConfidence = s.pulseConf ? s.pulseConf(t, c) : 85;
      }
    }
    return sample;
  }

  /** Run until time `until` (absolute ms). */
  runTo(until: number): void {
    const step = 1000 / 30;
    while (this.t <= until) {
      const t = Math.round(this.t * 1000) / 1000;
      this.engine.ingest(this.sampleAt(t));
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].at <= t) {
          const [{ id }] = this.pending.splice(i, 1);
          this.engine.speechEnded(id, t);
        }
      }
      this.t += step;
    }
  }

  /** Run until a predicate holds or the limit passes; returns the time it held. */
  runUntil(pred: () => boolean, limitMs: number): number | null {
    const step = 1000 / 30;
    const end = this.t + limitMs;
    while (this.t <= end) {
      this.runTo(this.t);
      if (pred()) return this.t - step;
    }
    return null;
  }

  phases(): string[] {
    return this.events.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase);
  }

  last<T extends EngineEvent['type']>(type: T): Extract<EngineEvent, { type: T }> | undefined {
    return [...this.events].reverse().find((e) => e.type === type) as
      | Extract<EngineEvent, { type: T }>
      | undefined;
  }
}
