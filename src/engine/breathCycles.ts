/**
 * Breath-cycle detection on the chest breathing trace.
 *
 * The raw trace is lightly smoothed, then turning points (peaks and troughs)
 * are found with hysteresis relative to the recent trace range, so slow
 * baseline wander and sensor noise do not create false breaths. Every
 * confirmed turning point yields a half-cycle estimate:
 *
 *   period    = time since the previous turning point of the same kind
 *   amplitude = |this turning point − the opposite turning point before it|
 *
 * so a steady breather produces ~2 estimates per breath. Any sample with
 * sdkConfidenceOk=false resets the detector (a cycle never spans a gap).
 *
 * Pure module.
 */

import type { CycleConfig } from './config';

export interface TurningPoint {
  tMs: number;
  value: number;
  kind: 'peak' | 'trough';
}

export interface CycleEstimate {
  /** Time the estimate became known (turning point confirmed). */
  tMs: number;
  /** Time of the turning point itself. */
  pointMs: number;
  periodMs: number;
  amplitude: number;
  kind: 'peak' | 'trough';
}

interface Point {
  t: number;
  v: number;
}

export class BreathCycleDetector {
  private smoothBuf: Point[] = [];
  private smoothHead = 0;
  private smoothSum = 0;
  private maxQ: Point[] = [];
  private minQ: Point[] = [];
  private rangeStartMs: number | null = null;
  private seeking: 'either' | 'peak' | 'trough' = 'either';
  private candMax: Point | null = null;
  private candMin: Point | null = null;
  private lastPeak: TurningPoint | null = null;
  private lastTrough: TurningPoint | null = null;
  private lastTp: TurningPoint | null = null;
  private _lastEstimate: CycleEstimate | null = null;
  private _smoothed: number | null = null;

  constructor(private readonly cfg: CycleConfig) {}

  reset(): void {
    this.smoothBuf = [];
    this.smoothHead = 0;
    this.smoothSum = 0;
    this.maxQ = [];
    this.minQ = [];
    this.rangeStartMs = null;
    this.seeking = 'either';
    this.candMax = null;
    this.candMin = null;
    this.lastPeak = null;
    this.lastTrough = null;
    this.lastTp = null;
    this._lastEstimate = null;
    this._smoothed = null;
  }

  /** Latest smoothed trace value (null after a reset until data arrives). */
  get smoothed(): number | null {
    return this._smoothed;
  }

  get lastEstimate(): CycleEstimate | null {
    return this._lastEstimate;
  }

  get lastTurningPoint(): TurningPoint | null {
    return this.lastTp;
  }

  /** Midpoint between the latest peak and trough: the trace's current resting line. */
  get center(): number | null {
    if (!this.lastPeak || !this.lastTrough) return null;
    return (this.lastPeak.value + this.lastTrough.value) / 2;
  }

  /** Recent trace range (max − min of the smoothed trace over the range window). */
  get range(): number | null {
    if (this.maxQ.length === 0 || this.minQ.length === 0) return null;
    return this.maxQ[0].v - this.minQ[0].v;
  }

  /**
   * Feed one sample. Returns a new half-cycle estimate when a turning point is
   * confirmed and both a period and an amplitude can be measured.
   */
  push(tMs: number, value: number | undefined, ok: boolean): CycleEstimate | null {
    if (!ok) {
      if (this._smoothed !== null || this.smoothBuf.length > 0) this.reset();
      return null;
    }
    if (value === undefined || !Number.isFinite(value)) return null;

    // Moving-average smoothing.
    this.smoothBuf.push({ t: tMs, v: value });
    this.smoothSum += value;
    while (
      this.smoothHead < this.smoothBuf.length &&
      this.smoothBuf[this.smoothHead].t < tMs - this.cfg.smoothingMs
    ) {
      this.smoothSum -= this.smoothBuf[this.smoothHead].v;
      this.smoothHead++;
    }
    if (this.smoothHead > 512) {
      this.smoothBuf = this.smoothBuf.slice(this.smoothHead);
      this.smoothHead = 0;
    }
    const s = this.smoothSum / (this.smoothBuf.length - this.smoothHead);
    this._smoothed = s;

    // Rolling range with monotonic deques.
    const p = { t: tMs, v: s };
    while (this.maxQ.length > 0 && this.maxQ[this.maxQ.length - 1].v <= s) this.maxQ.pop();
    this.maxQ.push(p);
    while (this.minQ.length > 0 && this.minQ[this.minQ.length - 1].v >= s) this.minQ.pop();
    this.minQ.push(p);
    const cutoff = tMs - this.cfg.rangeWindowMs;
    while (this.maxQ.length > 1 && this.maxQ[0].t < cutoff) this.maxQ.shift();
    while (this.minQ.length > 1 && this.minQ[0].t < cutoff) this.minQ.shift();
    if (this.rangeStartMs === null) this.rangeStartMs = tMs;

    // Wait for a little history so the hysteresis threshold is meaningful.
    if (tMs - this.rangeStartMs < 1_000) {
      this.trackCandidates(p);
      return null;
    }
    const thr = Math.max(this.cfg.hysteresisFrac * (this.maxQ[0].v - this.minQ[0].v), 1e-9);

    if (this.seeking === 'either') {
      this.trackCandidates(p);
      // A candidate sitting on the first sample is a boundary, not a turning
      // point: the trace may have been rising or falling into it.
      const interior = (c: Point) => c.t > (this.rangeStartMs as number) + this.cfg.smoothingMs;
      if (this.candMax && interior(this.candMax) && s < this.candMax.v - thr) {
        return this.confirm({ tMs: this.candMax.t, value: this.candMax.v, kind: 'peak' }, tMs, p);
      }
      if (this.candMin && interior(this.candMin) && s > this.candMin.v + thr) {
        return this.confirm({ tMs: this.candMin.t, value: this.candMin.v, kind: 'trough' }, tMs, p);
      }
      return null;
    }
    if (this.seeking === 'peak') {
      if (!this.candMax || s > this.candMax.v) this.candMax = p;
      if (s < this.candMax.v - thr) {
        return this.confirm({ tMs: this.candMax.t, value: this.candMax.v, kind: 'peak' }, tMs, p);
      }
      return null;
    }
    if (!this.candMin || s < this.candMin.v) this.candMin = p;
    if (s > this.candMin.v + thr) {
      return this.confirm({ tMs: this.candMin.t, value: this.candMin.v, kind: 'trough' }, tMs, p);
    }
    return null;
  }

  private trackCandidates(p: Point): void {
    if (!this.candMax || p.v > this.candMax.v) this.candMax = p;
    if (!this.candMin || p.v < this.candMin.v) this.candMin = p;
  }

  private confirm(tp: TurningPoint, nowMs: number, current: Point): CycleEstimate | null {
    const prevSame = tp.kind === 'peak' ? this.lastPeak : this.lastTrough;
    const opposite = tp.kind === 'peak' ? this.lastTrough : this.lastPeak;
    if (tp.kind === 'peak') {
      this.lastPeak = tp;
      this.seeking = 'trough';
      this.candMin = current;
      this.candMax = null;
    } else {
      this.lastTrough = tp;
      this.seeking = 'peak';
      this.candMax = current;
      this.candMin = null;
    }
    this.lastTp = tp;
    if (!prevSame || !opposite || opposite.tMs < prevSame.tMs) return null;
    const periodMs = tp.tMs - prevSame.tMs;
    const amplitude = Math.abs(tp.value - opposite.value);
    if (periodMs < this.cfg.minPeriodMs || periodMs > this.cfg.maxPeriodMs || !(amplitude > 0)) return null;
    const est: CycleEstimate = { tMs: nowMs, pointMs: tp.tMs, periodMs, amplitude, kind: tp.kind };
    this._lastEstimate = est;
    return est;
  }
}
