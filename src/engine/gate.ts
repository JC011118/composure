/**
 * The Composure Gate.
 *
 * After each answer, the next question waits until the live breathing trace
 * settles back inside the user's own seated band:
 *
 *   band = seated mean ± bandSdMultiplier × seated SD   (period AND amplitude)
 *
 * The trace counts as "inside the band" at time t when all hold:
 *   - the signal is usable (sdkConfidenceOk)
 *   - the latest breath half-cycle has period and amplitude inside the band
 *   - the current half-cycle has not run longer than the band allows
 *     (catches a held breath before the cycle completes)
 *   - the trace has not swung beyond half the upper amplitude bound from its
 *     resting line (catches a deep breath before the cycle completes)
 *
 * It unlocks once the trace has stayed inside for `holdMs` consecutive
 * milliseconds; it unlocks anyway at `timeoutMs` and the question is marked
 * "recovery: timed out". recoveryTimeMs = when the final in-band streak began,
 * measured from Gate start (0 means the trace was already inside the band).
 *
 * Pure module.
 */

import type { BaselineConfig, CycleConfig, GateConfig } from './config';
import { BreathCycleDetector, type CycleEstimate } from './breathCycles';
import type { SignalSample } from './types';

export interface BreathStats {
  periodMeanMs: number;
  periodSdMs: number;
  ampMean: number;
  ampSd: number;
  nEstimates: number;
  /** Median amplitude, used for the fallback band. */
  ampMedian: number | null;
}

export interface Band {
  periodMeanMs: number;
  periodLoMs: number;
  periodHiMs: number;
  ampMean: number;
  ampLo: number;
  ampHi: number;
  /** True when built from this user's seated baseline; false for the wide fallback. */
  personal: boolean;
}

export type OutReason = 'gap' | 'no-cycle' | 'period' | 'amplitude' | 'held' | 'excursion' | 'no-data';

export interface GateStatus {
  tMs: number;
  elapsedMs: number;
  inBand: boolean;
  outReason: OutReason | null;
  streakMs: number;
  /** 0..1 progress toward the hold requirement. */
  holdProgress: number;
  /** 0 at the band center, 1 at the band edge, >1 outside; null when unknown. */
  deviation: number | null;
  latest: CycleEstimate | null;
  /** Current resting line of the trace (for drawing the band around it). */
  center: number | null;
  smoothed: number | null;
  unlocked: boolean;
  timedOut: boolean;
}

export type GateOutcome = 'settled' | 'timed out' | 'paced pause' | 'skipped';

export interface GateResult {
  startMs: number;
  endMs: number;
  outcome: GateOutcome;
  timedOut: boolean;
  /** Gate start → start of the final in-band streak. Null when timed out, paced, or skipped. */
  recoveryTimeMs: number | null;
  /** Fraction of the Gate spent inside the band (diagnostic). */
  inBandFraction: number;
  /** Milliseconds the Gate was held closed by each criterion (diagnostic, for tuning). */
  outReasonMs?: Partial<Record<OutReason, number>>;
  /** False when the Gate used the wide default band (too few seated breaths), not the user's own. */
  personalBand?: boolean;
}

export function computeBand(breath: BreathStats | null, gate: GateConfig, baseline: BaselineConfig): Band {
  if (breath && breath.nEstimates >= baseline.minCycleEstimates) {
    const pHalf = Math.max(gate.bandSdMultiplier * breath.periodSdMs, gate.minPeriodHalfWidthMs);
    const aHalf = Math.max(
      gate.bandSdMultiplier * breath.ampSd,
      gate.minAmplitudeHalfWidthFrac * breath.ampMean,
    );
    return {
      periodMeanMs: breath.periodMeanMs,
      periodLoMs: breath.periodMeanMs - pHalf,
      periodHiMs: breath.periodMeanMs + pHalf,
      ampMean: breath.ampMean,
      ampLo: Math.max(0, breath.ampMean - aHalf),
      ampHi: breath.ampMean + aHalf,
      personal: true,
    };
  }
  const { lo, hi } = baseline.fallbackPeriodMs;
  const med = breath?.ampMedian ?? null;
  return {
    periodMeanMs: (lo + hi) / 2,
    periodLoMs: lo,
    periodHiMs: hi,
    ampMean: med ?? 0,
    ampLo: med !== null ? med * (1 - baseline.fallbackAmplitudeFrac) : 0,
    ampHi: med !== null ? med * (1 + baseline.fallbackAmplitudeFrac) : Number.POSITIVE_INFINITY,
    personal: false,
  };
}

/** Normalized distance of a value from the band center: 0 center, 1 edge. */
function sideDistance(v: number, mean: number, lo: number, hi: number): number {
  if (v >= mean) return hi > mean ? (v - mean) / (hi - mean) : v === mean ? 0 : Number.POSITIVE_INFINITY;
  return mean > lo ? (mean - v) / (mean - lo) : Number.POSITIVE_INFINITY;
}

export class GateDetector {
  private readonly cycles: BreathCycleDetector;
  private streakStart: number | null = null;
  private lastT: number;
  private lastSampleT: number | null = null;
  private inBandMs = 0;
  private readonly outMs: Partial<Record<OutReason, number>> = {};
  private _status: GateStatus;
  private _result: GateResult | null = null;

  constructor(
    readonly band: Band,
    private readonly cfg: GateConfig,
    cycleCfg: CycleConfig,
    readonly startMs: number,
  ) {
    this.cycles = new BreathCycleDetector(cycleCfg);
    this.lastT = startMs;
    this._status = this.makeStatus(startMs, false, 'no-data');
  }

  get status(): GateStatus {
    return this._status;
  }

  get result(): GateResult | null {
    return this._result;
  }

  /** Feed trace history from before the Gate so the current cycle is already known. */
  seed(samples: readonly SignalSample[]): void {
    for (const s of samples) {
      if (s.tMs >= this.startMs) break;
      this.cycles.push(s.tMs, s.breathingTrace, s.sdkConfidenceOk);
    }
  }

  push(sample: SignalSample): GateStatus {
    if (this._result) return this._status;
    const t = sample.tMs;
    this.cycles.push(t, sample.breathingTrace, sample.sdkConfidenceOk);
    if (t < this.startMs) return this._status;
    this.lastSampleT = t;
    const reason = this.evaluate(t, sample.sdkConfidenceOk);
    return this.step(t, reason);
  }

  /** Advance time without a sample (SDK stalled). The streak cannot grow without data. */
  tick(tMs: number): GateStatus {
    if (this._result || tMs <= this.lastT) return this._status;
    const reference = this.lastSampleT ?? this.startMs;
    if (tMs - reference <= this.cfg.stallMs) return this._status;
    return this.step(tMs, 'no-data');
  }

  /** End the Gate early without measuring (user skipped). */
  skip(tMs: number): GateResult {
    return this.finish(tMs, 'skipped', null);
  }

  private evaluate(t: number, ok: boolean): OutReason | null {
    if (!ok) return 'gap';
    const est = this.cycles.lastEstimate;
    const b = this.band;
    if (!est || t - est.tMs > b.periodHiMs * (1 + this.cfg.turningPointSlack)) return 'no-cycle';
    if (est.periodMs < b.periodLoMs || est.periodMs > b.periodHiMs) return 'period';
    if (est.amplitude < b.ampLo || est.amplitude > b.ampHi) return 'amplitude';
    const tp = this.cycles.lastTurningPoint;
    if (tp && t - tp.tMs > (b.periodHiMs / 2) * (1 + this.cfg.turningPointSlack)) return 'held';
    const center = this.cycles.center;
    const s = this.cycles.smoothed;
    if (center !== null && s !== null && Number.isFinite(b.ampHi)) {
      if (Math.abs(s - center) > (b.ampHi / 2) * this.cfg.excursionTolerance) return 'excursion';
    }
    return null;
  }

  private step(t: number, reason: OutReason | null): GateStatus {
    // Late samples (after a stall tick moved the clock on) never count time twice.
    const dt = Math.max(0, t - this.lastT);
    const inBand = reason === null;
    if (inBand) {
      this.inBandMs += dt;
      if (this.streakStart === null) this.streakStart = t;
    } else {
      this.streakStart = null;
      if (reason) this.outMs[reason] = (this.outMs[reason] ?? 0) + dt;
    }
    this.lastT = Math.max(this.lastT, t);
    const streakMs = this.streakStart === null ? 0 : t - this.streakStart;
    if (inBand && streakMs >= this.cfg.holdMs) {
      this.finish(t, 'settled', (this.streakStart as number) - this.startMs);
    } else if (t - this.startMs >= this.cfg.timeoutMs) {
      this.finish(t, 'timed out', null);
    }
    this._status = this.makeStatus(t, inBand, reason);
    return this._status;
  }

  private finish(t: number, outcome: GateOutcome, recoveryTimeMs: number | null): GateResult {
    if (this._result) return this._result;
    const dur = Math.max(1, t - this.startMs);
    this._result = {
      startMs: this.startMs,
      endMs: t,
      outcome,
      timedOut: outcome === 'timed out',
      recoveryTimeMs,
      personalBand: this.band.personal,
      inBandFraction: Math.min(1, this.inBandMs / dur),
      outReasonMs: Object.fromEntries(
        Object.entries(this.outMs).map(([k, v]) => [k, Math.round(v as number)]),
      ) as Partial<Record<OutReason, number>>,
    };
    this._status = this.makeStatus(t, this._status?.inBand ?? false, this._status?.outReason ?? null);
    return this._result;
  }

  private makeStatus(t: number, inBand: boolean, outReason: OutReason | null): GateStatus {
    const est = this.cycles.lastEstimate;
    const b = this.band;
    let deviation: number | null = null;
    if (est) {
      const dp = sideDistance(est.periodMs, b.periodMeanMs, b.periodLoMs, b.periodHiMs);
      const da = Number.isFinite(b.ampHi) ? sideDistance(est.amplitude, b.ampMean, b.ampLo, b.ampHi) : 0;
      deviation = Math.max(dp, da);
      if (!Number.isFinite(deviation)) deviation = 3;
    }
    const streakMs = this.streakStart === null ? 0 : t - this.streakStart;
    return {
      tMs: t,
      elapsedMs: t - this.startMs,
      inBand,
      outReason: inBand ? null : outReason,
      streakMs,
      holdProgress: Math.min(1, streakMs / this.cfg.holdMs),
      deviation,
      latest: est,
      center: this.cycles.center,
      smoothed: this.cycles.smoothed,
      unlocked: this._result !== null,
      timedOut: this._result?.timedOut ?? false,
    };
  }
}
