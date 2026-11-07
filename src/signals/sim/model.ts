/**
 * A seeded synthetic person for simulator mode.
 *
 * Produces the same normalized samples the SDK path produces: a 30 Hz chest
 * breathing trace, ~1 Hz breathing rate (lagging, windowed like the SDK's),
 * ~1 Hz pulse with confidence that dips while talking, talking/blinking flags
 * with frame-level flicker, session HRV after ~60 s, occasional signal
 * dropouts, and a camera-tuning warm-up.
 *
 * It reacts to interview events (`observe`) so every screen and cue can be
 * exercised: it answers after a short latency, pauses, goes quiet on a hard
 * question, rambles until cut off, and settles during the Gate at a
 * scenario-defined pace. Deterministic for a given seed and event sequence.
 */

import { clamp, gaussian, mulberry32 } from '../../engine/stats';
import type { EngineEvent, HrvSample, SignalSample, SignalStatus } from '../../engine/types';
import { behaviorFor, GATE_TAU_MS, type AnswerStyle, type QuestionBehavior } from './scenarios';

export interface SimPersonOptions {
  seed: number;
  scenario?: string;
  /** Trace sample rate (Hz). */
  sampleRateHz?: number;
  /** Multiplier on measurement noise (1 = default). */
  noise?: number;
  /** Mean random signal dropouts per minute (0 disables). */
  dropoutsPerMinute?: number;
  /** Camera-tuning period at start, during which the signal is not usable. */
  warmupMs?: number;
}

/** Hints mimic the SDK's validation hints (shown as-is in the HUD). */
export const SIM_HINTS: Record<number, string> = {
  0: '',
  10: 'Camera is adjusting, hold on a moment',
  12: 'Hold still, motion may affect accuracy',
};

const FRESH_MS = 2_500;

class TalkPlanner {
  talking = false;
  until = Number.POSITIVE_INFINITY;
  private mode: 'silent' | 'reading' | 'answer' = 'silent';
  private style: AnswerStyle = 'normal';
  private stage = 0;
  private budgetMs = 0;
  private spokenMs = 0;
  private segStart = 0;
  private waitingFor: 'A' | 'B' | null = null;
  /** Hesitant answers go quiet here; the model raises arousal while true. */
  holdingSilence = false;

  constructor(private readonly rand: () => number) {}

  private u(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rand();
  }

  setSilent(): void {
    this.mode = 'silent';
    this.talking = false;
    this.until = Number.POSITIVE_INFINITY;
    this.holdingSilence = false;
    this.waitingFor = null;
  }

  startReading(t: number): void {
    this.mode = 'reading';
    this.talking = false;
    this.until = t + this.u(700, 1500);
  }

  startAnswer(t: number, style: AnswerStyle): void {
    this.mode = 'answer';
    this.style = style;
    this.stage = 0;
    this.spokenMs = 0;
    this.talking = false;
    this.holdingSilence = false;
    this.waitingFor = null;
    this.budgetMs =
      style === 'normal'
        ? this.u(22_000, 40_000)
        : style === 'brief'
          ? this.u(5_000, 7_000)
          : style === 'rambling'
            ? 200_000
            : 2_500; // hesitant opener
    this.until = t + (style === 'hesitant' ? this.u(1_800, 2_600) : this.u(1_200, 3_200));
  }

  onCue(t: number, cue: 'A' | 'B'): void {
    if (this.mode !== 'answer' || this.waitingFor !== cue) return;
    this.waitingFor = null;
    if (cue === 'A') {
      // Hear "Take your time.", then resume.
      this.until = t + this.u(2_000, 3_000);
    } else {
      // Interrupted: stop, listen, then summarize in one sentence.
      if (this.talking) this.spokenMs += t - this.segStart;
      this.talking = false;
      this.stage = 9;
      this.until = t + this.u(1_800, 2_600);
    }
  }

  isTalking(t: number): boolean {
    let guard = 0;
    while (t >= this.until && guard++ < 1000) this.advance(this.until);
    return this.talking;
  }

  private startSegment(at: number, maxLen: number): void {
    this.talking = true;
    this.segStart = at;
    this.until = at + Math.max(400, Math.min(this.u(2_000, 8_000), maxLen));
  }

  private endSegment(at: number): void {
    this.spokenMs += at - this.segStart;
    this.talking = false;
  }

  private advance(at: number): void {
    if (this.mode === 'silent') {
      this.until = Number.POSITIVE_INFINITY;
      return;
    }
    if (this.mode === 'reading') {
      if (this.talking) {
        this.talking = false;
        this.until = at + this.u(400, 1_100);
      } else {
        this.talking = true;
        this.until = at + this.u(3_000, 7_000);
      }
      return;
    }
    // Answer modes.
    if (this.style === 'hesitant' && this.stage === 0) {
      if (!this.talking) {
        this.talking = true;
        this.segStart = at;
        this.until = at + this.budgetMs;
      } else {
        this.endSegment(at);
        this.stage = 1;
        this.holdingSilence = true;
        this.waitingFor = 'A';
        // If no cue arrives, resume on our own after a long silence.
        this.until = at + 14_000;
      }
      return;
    }
    if (this.style === 'hesitant' && this.stage === 1) {
      this.holdingSilence = false;
      this.waitingFor = null;
      this.stage = 2;
      this.spokenMs = 0;
      this.budgetMs = this.u(16_000, 22_000);
      this.startSegment(at, this.budgetMs);
      return;
    }
    if (this.stage === 9) {
      // Cue B summary: one sentence, then done.
      if (!this.talking) {
        this.talking = true;
        this.segStart = at;
        this.until = at + this.u(5_000, 7_000);
      } else {
        this.talking = false;
        this.until = Number.POSITIVE_INFINITY;
      }
      return;
    }
    if (this.style === 'rambling') {
      if (this.talking) {
        this.endSegment(at);
        if (this.spokenMs >= this.budgetMs) {
          this.until = Number.POSITIVE_INFINITY;
          return;
        }
        this.waitingFor = 'B';
        this.until = at + this.u(300, 1_100);
      } else {
        this.waitingFor = 'B';
        this.talking = true;
        this.segStart = at;
        this.until = at + this.u(4_000, 10_000);
      }
      return;
    }
    // normal / brief / hesitant stage 2
    if (this.talking) {
      this.endSegment(at);
      if (this.spokenMs >= this.budgetMs) {
        this.until = Number.POSITIVE_INFINITY;
        return;
      }
      this.until = at + (this.rand() < 0.3 ? this.u(1_600, 2_800) : this.u(300, 1_200));
    } else {
      if (this.spokenMs >= this.budgetMs) {
        this.until = Number.POSITIVE_INFINITY;
        return;
      }
      this.startSegment(at, this.budgetMs - this.spokenMs + 300);
    }
  }
}

export interface SimFrame {
  sample: SignalSample;
  /** Present only when the validation status changed on this frame. */
  status?: SignalStatus;
}

export class SimPerson {
  readonly sampleRateHz: number;
  private readonly rand: () => number;
  private readonly noise: number;
  private readonly dropoutsPerMinute: number;
  private readonly warmupMs: number;
  private readonly scenario: string;

  // Fixed physiology for this seed.
  readonly basePeriodMs: number;
  readonly baseAmp: number;
  readonly baseHr: number;
  private readonly wanderPhase: [number, number];

  // Dynamic state.
  private arousal = 0;
  private arousalTarget = 0;
  private arousalTauMs = 8_000;
  private phase = 0;
  private cycleJitterP = 1;
  private cycleJitterA = 1;
  private cycleShapeTalk = false;
  private cycleTalkPeriodMs = 4_500;
  /** This breath is a sigh: deeper and slower (about 1 in 25 resting breaths). */
  private cycleSigh = false;
  private ampSmooth: number | null = null;
  private talk: TalkPlanner;
  private behavior: QuestionBehavior;
  private questionIndex = 0;
  private flickerUntil = -1;
  private blinkAt: number;
  private blinkUntil = -1;
  private dropoutAt: number;
  private dropoutUntil = -1;
  private lastT: number | null = null;
  private okSince: number | null = null;
  private lastCode = -1;
  private wasHolding = false;

  // SDK-like slow outputs (carried forward while fresh).
  private periodBuckets: { second: number; sum: number; n: number }[] = [];
  private talkBuckets: { second: number; talk: number; n: number }[] = [];
  private nextSlowAt = 1_000;
  private rate: { v: number; c: number; t: number } | null = null;
  private pulse: { v: number; c: number; t: number } | null = null;
  private hrv: { v: HrvSample; t: number } | null = null;
  private pulseWander = 0;

  constructor(opts: SimPersonOptions) {
    this.rand = mulberry32(opts.seed);
    this.sampleRateHz = opts.sampleRateHz ?? 30;
    this.noise = opts.noise ?? 1;
    this.dropoutsPerMinute = opts.dropoutsPerMinute ?? 0.6;
    this.warmupMs = opts.warmupMs ?? 2_500;
    this.scenario = opts.scenario ?? 'demo';
    this.basePeriodMs = this.u(4_000, 5_200);
    this.baseAmp = this.u(0.8, 1.2);
    this.baseHr = this.u(60, 76);
    this.wanderPhase = [this.u(0, 2 * Math.PI), this.u(0, 2 * Math.PI)];
    this.talk = new TalkPlanner(mulberry32(opts.seed ^ 0x5bd1e995));
    this.behavior = behaviorFor(this.scenario, 0);
    this.blinkAt = this.u(1_500, 4_000);
    this.dropoutAt = this.scheduleDropout(this.warmupMs + 20_000);
  }

  private u(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rand();
  }

  private n(): number {
    return gaussian(this.rand);
  }

  private scheduleDropout(from: number): number {
    if (this.dropoutsPerMinute <= 0) return Number.POSITIVE_INFINITY;
    const mean = 60_000 / this.dropoutsPerMinute;
    return from + this.u(0.5, 1.5) * mean;
  }

  private setArousal(target: number, tauMs: number): void {
    this.arousalTarget = target;
    this.arousalTauMs = tauMs;
  }

  /** React to the interview. */
  observe(e: EngineEvent): void {
    switch (e.type) {
      case 'phase':
        // A phase change ends any held silence; do not let it override the new phase's target.
        this.wasHolding = false;
        this.questionIndex = e.questionIndex;
        this.behavior = behaviorFor(this.scenario, Math.max(0, e.questionIndex));
        switch (e.phase) {
          case 'signalCheck':
          case 'baselineSeated':
            this.talk.setSilent();
            this.setArousal(0, 6_000);
            break;
          case 'baselineTalking':
            this.talk.startReading(e.tMs);
            this.setArousal(0.12, 6_000);
            break;
          case 'asking':
            this.talk.setSilent();
            this.setArousal(this.behavior.arousalOnAsk, 4_000);
            break;
          case 'listening':
            this.talk.startAnswer(e.tMs, this.behavior.answer);
            this.setArousal(this.behavior.answer === 'brief' ? 0.6 : 0.5, 5_000);
            break;
          case 'gate':
            this.talk.setSilent();
            this.setArousal(0, GATE_TAU_MS[this.behavior.gate]);
            break;
          default:
            this.talk.setSilent();
            this.setArousal(0, 6_000);
        }
        break;
      case 'cue':
        this.talk.onCue(e.event.tMs, e.event.cue);
        if (e.event.cue === 'A') this.setArousal(0.5, 4_000);
        break;
      default:
        break;
    }
  }

  /** Produce the frame at time `t` (ms). Call with strictly increasing t. */
  generate(t: number): SimFrame {
    const dt = this.lastT === null ? 1000 / this.sampleRateHz : Math.max(0, t - this.lastT);
    this.lastT = t;

    // --- talking (planned) and arousal --------------------------------
    const planned = this.talk.isTalking(t);
    if (this.talk.holdingSilence) this.setArousal(1, 2_500);
    else if (this.wasHolding) this.setArousal(0.5, 4_000);
    this.wasHolding = this.talk.holdingSilence;
    this.arousal += (this.arousalTarget - this.arousal) * (1 - Math.exp(-dt / this.arousalTauMs));
    const a = this.arousal;

    // --- validation / dropouts -----------------------------------------
    if (t >= this.dropoutAt && this.dropoutUntil < t) {
      this.dropoutUntil = t + this.u(800, 2_500);
      this.dropoutAt = this.scheduleDropout(this.dropoutUntil);
    }
    const code = t < this.warmupMs ? 10 : t < this.dropoutUntil ? 12 : 0;
    const ok = code === 0;
    if (ok && this.okSince === null) this.okSince = t;
    let status: SignalStatus | undefined;
    if (code !== this.lastCode) {
      this.lastCode = code;
      status = { tMs: t, code, hint: SIM_HINTS[code] ?? '' };
    }

    // --- breathing trace -------------------------------------------------
    const quietPeriod =
      clamp(this.basePeriodMs * (1 - 0.32 * a) * this.cycleJitterP, 3_000, 6_500) *
      (this.cycleSigh ? 1.3 : 1);
    const period = this.cycleShapeTalk ? this.cycleTalkPeriodMs : quietPeriod;
    this.phase += (2 * Math.PI * dt) / period;
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
      this.cycleJitterP = clamp(1 + 0.04 * this.n(), 0.88, 1.12);
      this.cycleJitterA = clamp(1 + 0.04 * this.n(), 0.88, 1.12);
      this.cycleShapeTalk = planned;
      this.cycleTalkPeriodMs = this.u(3_500, 5_500);
      this.cycleSigh = !planned && this.rand() < 0.04;
    }
    const x = this.phase / (2 * Math.PI);
    let shape: number;
    let amp: number;
    if (this.cycleShapeTalk) {
      // Speech breathing: quick inhale, long controlled exhale.
      shape = x < 0.2 ? -0.5 * Math.cos((Math.PI * x) / 0.2) : 0.5 * Math.cos((Math.PI * (x - 0.2)) / 0.8);
      amp = 0.8 * this.baseAmp * this.cycleJitterA * (1 + 0.3 * a);
    } else {
      shape = -0.5 * Math.cos(2 * Math.PI * x) + 0.04 * Math.sin(4 * Math.PI * x);
      amp = this.baseAmp * (1 + 0.9 * a) * this.cycleJitterA * (this.cycleSigh ? 1.8 : 1);
    }
    this.ampSmooth =
      this.ampSmooth === null ? amp : this.ampSmooth + (amp - this.ampSmooth) * (1 - Math.exp(-dt / 350));
    amp = this.ampSmooth;
    const wander =
      0.12 * this.baseAmp * Math.sin((2 * Math.PI * t) / 41_000 + this.wanderPhase[0]) +
      0.05 * this.baseAmp * Math.sin((2 * Math.PI * t) / 17_000 + this.wanderPhase[1]);
    const noiseSd = 0.02 * this.baseAmp * this.noise * (ok ? 1 : 6);
    const trace = amp * shape + wander + noiseSd * this.n();

    // Track instantaneous period and talking for the windowed SDK-like rate.
    const second = Math.floor(t / 1000);
    const lastP = this.periodBuckets[this.periodBuckets.length - 1];
    if (!lastP || lastP.second !== second) this.periodBuckets.push({ second, sum: period, n: 1 });
    else {
      lastP.sum += period;
      lastP.n++;
    }
    const lastTk = this.talkBuckets[this.talkBuckets.length - 1];
    if (!lastTk || lastTk.second !== second) this.talkBuckets.push({ second, talk: planned ? 1 : 0, n: 1 });
    else {
      lastTk.talk += planned ? 1 : 0;
      lastTk.n++;
    }
    while (this.periodBuckets.length > 15) this.periodBuckets.shift();
    while (this.talkBuckets.length > 6) this.talkBuckets.shift();

    // --- ~1 Hz slow outputs ---------------------------------------------
    if (t >= this.nextSlowAt) {
      this.nextSlowAt += 1_000;
      if (ok && this.okSince !== null) this.updateSlow(t, a);
    }

    // --- talking flags with frame-level flicker -----------------------------
    let rawTalking = planned;
    if (t < this.flickerUntil) rawTalking = !planned;
    else if (planned && this.rand() < dt / 1_500) this.flickerUntil = t + this.u(40, 250);
    else if (!planned && this.rand() < dt / 25_000) this.flickerUntil = t + this.u(60, 140);

    // --- blinking ----------------------------------------------------------
    if (t >= this.blinkAt) {
      this.blinkUntil = t + this.u(120, 200);
      this.blinkAt = t + this.u(2_500, 6_000);
    }
    const blinking = t < this.blinkUntil;

    const sample: SignalSample = {
      tMs: t,
      breathingTrace: trace,
      talking: rawTalking,
      blinking,
      sdkConfidenceOk: ok,
    };
    if (ok) {
      if (this.rate && t - this.rate.t <= FRESH_MS) {
        sample.breathingRate = this.rate.v;
        sample.breathingRateConfidence = this.rate.c;
      }
      if (this.pulse && t - this.pulse.t <= FRESH_MS) {
        sample.pulseBpm = this.pulse.v;
        sample.pulseConfidence = this.pulse.c;
      }
      if (this.hrv && t - this.hrv.t <= FRESH_MS) sample.hrv = this.hrv.v;
    }
    return status ? { sample, status } : { sample };
  }

  private updateSlow(t: number, a: number): void {
    const okFor = t - (this.okSince as number);
    const talkFrac =
      this.talkBuckets.reduce((s, b) => s + b.talk, 0) /
      Math.max(
        1,
        this.talkBuckets.reduce((s, b) => s + b.n, 0),
      );
    const talkingNow = talkFrac > 0.4;

    // Breathing rate: windowed mean of the period (lags like the SDK's ~30 s window).
    const pSum = this.periodBuckets.reduce((s, b) => s + b.sum, 0);
    const pN = this.periodBuckets.reduce((s, b) => s + b.n, 0);
    if (pN > 0) {
      const ramp = clamp(okFor / 30_000, 0, 1);
      const conf = clamp(ramp * (talkingNow ? 38 + 8 * this.n() : 82 + 5 * this.n()), 0, 99);
      this.rate = { v: 60_000 / (pSum / pN) + 0.2 * this.n(), c: conf, t };
    }

    // Pulse: rises with arousal and talking; confidence dips while talking.
    this.pulseWander += (0 - this.pulseWander) * 0.04 + 0.35 * this.n();
    // Respiratory sinus arrhythmia: pulse rises on the in-breath and falls on the out-breath.
    const rsa = 2.2 * Math.sin(this.phase);
    const hr = this.baseHr + 14 * a + (talkingNow ? 5 : 0) + this.pulseWander + rsa + 0.6 * this.n();
    const pulseRamp = clamp(okFor / 12_000, 0, 1);
    const good = this.behavior.pulse === 'good';
    const pc = talkingNow
      ? good
        ? 60 + 12 * this.n()
        : 28 + 10 * this.n()
      : (good ? 86 : 70) + 5 * this.n();
    this.pulse = { v: clamp(hr, 55, 100), c: clamp(pulseRamp * pc, 0, 99), t };

    // HRV: needs ~60 s of clean signal.
    if (okFor >= 60_000) {
      const hrvConf = clamp(
        clamp((okFor - 60_000) / 30_000, 0, 1) * 78 - (talkingNow ? 25 : 0) + 3 * this.n(),
        0,
        99,
      );
      const meanNn = 60_000 / hr;
      this.hrv = {
        v: {
          rmssd: clamp(44 - 14 * a + 1.5 * this.n(), 12, 90),
          sdnn: clamp(55 - 12 * a + 2 * this.n(), 15, 110),
          meanNn,
          baevsky: clamp(90 + 120 * a + 10 * this.n(), 20, 600),
          confidence: hrvConf,
          stable: hrvConf >= 50,
        },
        t,
      };
    }
  }

  /** Internal state for tests and the HUD's simulator badge. */
  debugState(): { arousal: number; questionIndex: number; plannedTalking: boolean } {
    return { arousal: this.arousal, questionIndex: this.questionIndex, plannedTalking: this.talk.talking };
  }
}
