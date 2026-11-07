/**
 * Baseline statistics.
 *
 * Seated (silent) baseline: mean and SD of breath period and amplitude from
 * the trace's half-cycle estimates (these define the Gate band), plus mean
 * pulse and mean breathing rate. Talking baseline: mean pulse and mean
 * breathing rate while reading the passage aloud (pulse deltas per answer are
 * relative to this one, since answers are spoken).
 *
 * Only samples with sdkConfidenceOk contribute. Pulse readings below the
 * configured confidence do not count. Breathing-rate readings prefer those at
 * or above the SDK's stable confidence; if too few exist (the SDK's ~30 s
 * window has not filled yet) all clean readings are used and a note is added.
 *
 * Pure module.
 */

import type { BaselineConfig, DebriefConfig } from './config';
import type { CycleEstimate } from './breathCycles';
import type { BreathStats } from './gate';
import { mean, median, sd, type MeanSd } from './stats';
import type { SignalSample } from './types';

export type BaselineKind = 'seated' | 'talking';

export interface BaselineStats {
  kind: BaselineKind;
  startMs: number;
  endMs: number;
  /** Fraction of the phase with a usable signal. */
  validCoverage: number;
  breath: BreathStats | null;
  breathingRate: MeanSd | null;
  pulse: MeanSd | null;
  notes: string[];
}

export class BaselineAccumulator {
  private okMs = 0;
  private lastT: number | null = null;
  private readonly estimates: CycleEstimate[] = [];
  private readonly rateAll: number[] = [];
  private readonly rateConfident: number[] = [];
  private readonly pulses: number[] = [];

  constructor(
    readonly kind: BaselineKind,
    readonly startMs: number,
    private readonly baseCfg: BaselineConfig,
    private readonly debriefCfg: DebriefConfig,
  ) {}

  addSample(s: SignalSample): void {
    if (s.tMs < this.startMs) return;
    const dt = this.lastT === null ? 0 : Math.min(s.tMs - this.lastT, this.debriefCfg.maxSampleGapMs);
    this.lastT = s.tMs;
    if (!s.sdkConfidenceOk) return;
    this.okMs += Math.max(0, dt);
    if (s.breathingRate !== undefined && Number.isFinite(s.breathingRate)) {
      this.rateAll.push(s.breathingRate);
      if ((s.breathingRateConfidence ?? 0) >= this.baseCfg.breathingRateConfidenceMin) {
        this.rateConfident.push(s.breathingRate);
      }
    }
    if (
      s.pulseBpm !== undefined &&
      Number.isFinite(s.pulseBpm) &&
      (s.pulseConfidence ?? 0) >= this.debriefCfg.pulseConfidenceMin
    ) {
      this.pulses.push(s.pulseBpm);
    }
  }

  addEstimate(e: CycleEstimate): void {
    if (e.tMs >= this.startMs) this.estimates.push(e);
  }

  coverage(nowMs: number): number {
    const span = nowMs - this.startMs;
    return span > 0 ? Math.min(1, this.okMs / span) : 0;
  }

  finish(endMs: number): BaselineStats {
    const notes: string[] = [];
    let breath: BreathStats | null = null;
    if (this.kind === 'seated') {
      const periods = this.estimates.map((e) => e.periodMs);
      const amps = this.estimates.map((e) => e.amplitude);
      if (periods.length > 0) {
        breath = {
          periodMeanMs: mean(periods) as number,
          periodSdMs: sd(periods) as number,
          ampMean: mean(amps) as number,
          ampSd: sd(amps) as number,
          nEstimates: periods.length,
          ampMedian: median(amps),
        };
      }
      if (periods.length < this.baseCfg.minCycleEstimates) {
        notes.push(
          `Only ${periods.length} breath cycles were measured while seated, so the Gate uses a wide default band.`,
        );
      }
    }
    // Readings repeat at the sample rate while fresh; use enough confident readings or fall back to all.
    const useConfident = this.rateConfident.length >= 30;
    const rates = useConfident ? this.rateConfident : this.rateAll;
    if (!useConfident && this.rateAll.length > 0) {
      notes.push(
        'Breathing-rate confidence was still warming up; the baseline rate uses all clean readings.',
      );
    }
    const breathingRate =
      rates.length > 0 ? { mean: mean(rates) as number, sd: sd(rates) as number, n: rates.length } : null;
    const pulse =
      this.pulses.length > 0
        ? { mean: mean(this.pulses) as number, sd: sd(this.pulses) as number, n: this.pulses.length }
        : null;
    if (!pulse) notes.push('No clean pulse readings during this baseline.');
    return {
      kind: this.kind,
      startMs: this.startMs,
      endMs,
      validCoverage: this.coverage(endMs),
      breath,
      breathingRate,
      pulse,
      notes,
    };
  }
}
