/**
 * Debrief metric helpers: time-weighted means with coverage, silent spans,
 * and gap-preserving chart series. Pure module.
 */

import type { SignalSample, TalkSegment } from './types';

export interface WeightedStat {
  /** Time-weighted mean over the covered time, or null if nothing covered. */
  mean: number | null;
  /** Milliseconds of the window covered by an accepted value. */
  coveredMs: number;
  /** Window length. */
  spanMs: number;
  /** coveredMs / spanMs (0 when the span is empty). */
  coverage: number;
}

/** Index of the first sample with tMs >= t (samples are in time order). */
export function lowerBound(samples: readonly SignalSample[], t: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].tMs < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Time-weighted statistics of `pick(sample)` over [fromMs, toMs]. Each sample
 * covers the time until the next sample, capped at `maxGapMs`. `pick` returns
 * undefined to reject a sample (no value, low confidence, bad signal).
 */
export function timeWeighted(
  samples: readonly SignalSample[],
  fromMs: number,
  toMs: number,
  pick: (s: SignalSample) => number | undefined,
  maxGapMs: number,
): WeightedStat {
  const spanMs = Math.max(0, toMs - fromMs);
  if (spanMs === 0) return { mean: null, coveredMs: 0, spanMs: 0, coverage: 0 };
  let covered = 0;
  let sum = 0;
  for (let i = lowerBound(samples, fromMs - maxGapMs); i < samples.length; i++) {
    const s = samples[i];
    if (s.tMs >= toMs) break;
    const next = i + 1 < samples.length ? samples[i + 1].tMs : s.tMs + maxGapMs;
    const a = Math.max(s.tMs, fromMs);
    const b = Math.min(next, s.tMs + maxGapMs, toMs);
    if (b <= a) continue;
    const v = pick(s);
    if (v === undefined || !Number.isFinite(v)) continue;
    covered += b - a;
    sum += v * (b - a);
  }
  return {
    mean: covered > 0 ? sum / covered : null,
    coveredMs: covered,
    spanMs,
    coverage: covered / spanMs,
  };
}

/** Same as timeWeighted but over several disjoint spans. */
export function timeWeightedSpans(
  samples: readonly SignalSample[],
  spans: readonly TalkSegment[],
  pick: (s: SignalSample) => number | undefined,
  maxGapMs: number,
): WeightedStat {
  let covered = 0;
  let sum = 0;
  let spanMs = 0;
  for (const span of spans) {
    const st = timeWeighted(samples, span.startMs, span.endMs, pick, maxGapMs);
    covered += st.coveredMs;
    spanMs += st.spanMs;
    if (st.mean !== null) sum += st.mean * st.coveredMs;
  }
  return {
    mean: covered > 0 ? sum / covered : null,
    coveredMs: covered,
    spanMs,
    coverage: spanMs > 0 ? covered / spanMs : 0,
  };
}

/** Silent spans inside [fromMs, toMs] = the complement of the talk segments, keeping spans ≥ minMs. */
export function silentSpans(
  segments: readonly TalkSegment[],
  fromMs: number,
  toMs: number,
  minMs: number,
): TalkSegment[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const out: TalkSegment[] = [];
  let cursor = fromMs;
  for (const seg of sorted) {
    if (seg.endMs <= fromMs) continue;
    if (seg.startMs >= toMs) break;
    if (seg.startMs - cursor >= minMs) out.push({ startMs: cursor, endMs: seg.startMs });
    cursor = Math.max(cursor, seg.endMs);
  }
  if (toMs - cursor >= minMs) out.push({ startMs: cursor, endMs: toMs });
  return out;
}

/** [time relative to series start in ms, value or null (= gap)]. */
export type SeriesPoint = [number, number | null];

/**
 * Downsample to fixed buckets. A bucket's value is the mean of accepted
 * samples in it; a bucket with no accepted sample is a gap (null) — never an
 * interpolated number.
 */
export function bucketSeries(
  samples: readonly SignalSample[],
  fromMs: number,
  toMs: number,
  hz: number,
  pick: (s: SignalSample) => number | undefined,
  digits = 3,
): SeriesPoint[] {
  const step = 1000 / hz;
  const n = Math.max(0, Math.ceil((toMs - fromMs) / step));
  const sums = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  for (const s of samples) {
    if (s.tMs < fromMs || s.tMs >= toMs) continue;
    const v = pick(s);
    if (v === undefined || !Number.isFinite(v)) continue;
    const i = Math.floor((s.tMs - fromMs) / step);
    if (i < 0 || i >= n) continue;
    sums[i] += v;
    counts[i]++;
  }
  const f = 10 ** digits;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push([Math.round(i * step), counts[i] > 0 ? Math.round((sums[i] / counts[i]) * f) / f : null]);
  }
  return out;
}
