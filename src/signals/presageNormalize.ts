/**
 * Converts decoded SmartSpectra `Metrics` packets into normalized
 * SignalSamples. Works on the decoded object shape only (no SDK import), so
 * PresageSignalSource stays the only file that touches SDK APIs and this logic
 * is unit-testable.
 *
 * - One sample per `breathing.upperTrace[]` entry (the densest series).
 * - Slow series (breathing.rate, cardio.pulseRate, cardio.hrv) are attached to
 *   each sample while fresh (≤ freshMs old), never carried forward beyond that.
 * - `face.talking[]` / `face.blinking[]` are time-aligned to each trace sample.
 * - Timestamps are int64 µs since the Unix epoch (possibly `Long` objects);
 *   samples use ms since `originEpochMs` and are strictly increasing.
 * - sdkConfidenceOk mirrors the latest validationStatus (code 0 = OK).
 */

import type { HrvSample, SignalSample } from '../engine/types';

type Ts = number | { toNumber(): number } | null | undefined;

interface Measurement {
  value?: number | null;
  timestamp?: Ts;
}
interface MeasurementWithConfidence extends Measurement {
  confidence?: number | null;
  stable?: boolean | null;
}
interface DetectionStatus {
  detected?: boolean | null;
  timestamp?: Ts;
}
interface Hrv {
  rmssd?: number | null;
  sdnn?: number | null;
  meanNn?: number | null;
  baevsky?: number | null;
  confidence?: number | null;
  stable?: boolean | null;
  timestamp?: Ts;
}

/** Structural subset of `presage.smartspectra.Metrics` that Composure reads. */
export interface DecodedMetricsLike {
  breathing?: { rate?: MeasurementWithConfidence[] | null; upperTrace?: Measurement[] | null } | null;
  cardio?: { pulseRate?: MeasurementWithConfidence[] | null; hrv?: Hrv[] | null } | null;
  face?: { talking?: DetectionStatus[] | null; blinking?: DetectionStatus[] | null } | null;
}

export function tsToUs(ts: Ts): number | null {
  if (ts === null || ts === undefined) return null;
  const n = typeof ts === 'number' ? ts : typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface Latest<T> {
  v: T;
  tMs: number;
}

export interface NormalizerOptions {
  originEpochMs: number;
  /** Slow readings older than this are not attached to samples. */
  freshMs?: number;
}

export class MetricsNormalizer {
  private readonly origin: number;
  private readonly freshMs: number;
  private statusOk = false;
  private lastEmitted = Number.NEGATIVE_INFINITY;
  private rate: Latest<{ value: number; confidence: number }> | null = null;
  private pulse: Latest<{ value: number; confidence: number }> | null = null;
  private hrv: Latest<HrvSample> | null = null;
  private talking: Latest<boolean> | null = null;
  private blinking: Latest<boolean> | null = null;

  constructor(opts: NormalizerOptions) {
    this.origin = opts.originEpochMs;
    this.freshMs = opts.freshMs ?? 2_500;
  }

  /** Latest validationStatus: code 0 means the capture is usable. */
  setStatusOk(ok: boolean): void {
    this.statusOk = ok;
  }

  get ok(): boolean {
    return this.statusOk;
  }

  /** Convert an epoch-µs timestamp to source ms. */
  toMs(us: number): number {
    return us / 1000 - this.origin;
  }

  ingest(m: DecodedMetricsLike, packetTsUs?: number): SignalSample[] {
    const fallbackMs = packetTsUs !== undefined && packetTsUs > 0 ? this.toMs(packetTsUs) : null;
    const at = (ts: Ts): number | null => {
      const us = tsToUs(ts);
      return us !== null ? this.toMs(us) : fallbackMs;
    };

    for (const r of m.breathing?.rate ?? []) {
      const t = at(r.timestamp);
      if (t === null || typeof r.value !== 'number') continue;
      if (!this.rate || t >= this.rate.tMs)
        this.rate = { v: { value: r.value, confidence: r.confidence ?? 0 }, tMs: t };
    }
    for (const p of m.cardio?.pulseRate ?? []) {
      const t = at(p.timestamp);
      if (t === null || typeof p.value !== 'number') continue;
      if (!this.pulse || t >= this.pulse.tMs)
        this.pulse = { v: { value: p.value, confidence: p.confidence ?? 0 }, tMs: t };
    }
    for (const h of m.cardio?.hrv ?? []) {
      const t = at(h.timestamp);
      if (t === null || typeof h.rmssd !== 'number') continue;
      if (!this.hrv || t >= this.hrv.tMs) {
        const v: HrvSample = {
          rmssd: h.rmssd,
          sdnn: h.sdnn ?? 0,
          meanNn: h.meanNn ?? 0,
          confidence: h.confidence ?? 0,
          stable: h.stable === true,
        };
        if (typeof h.baevsky === 'number') v.baevsky = h.baevsky;
        this.hrv = { v, tMs: t };
      }
    }

    const events = (arr: DetectionStatus[] | null | undefined) =>
      (arr ?? [])
        .map((d) => ({ t: at(d.timestamp), v: d.detected === true }))
        .filter((e): e is { t: number; v: boolean } => e.t !== null)
        .sort((a, b) => a.t - b.t);
    const talk = events(m.face?.talking);
    const blink = events(m.face?.blinking);
    let ti = 0;
    let bi = 0;

    const traces = (m.breathing?.upperTrace ?? [])
      .map((e) => ({ t: at(e.timestamp), v: e.value }))
      .filter(
        (e): e is { t: number; v: number } => e.t !== null && typeof e.v === 'number' && Number.isFinite(e.v),
      )
      .sort((a, b) => a.t - b.t);

    const out: SignalSample[] = [];
    const emit = (t: number, trace: number | undefined) => {
      while (ti < talk.length && talk[ti].t <= t) this.talking = { v: talk[ti].v, tMs: talk[ti++].t };
      while (bi < blink.length && blink[bi].t <= t) this.blinking = { v: blink[bi].v, tMs: blink[bi++].t };
      if (t <= this.lastEmitted) return;
      this.lastEmitted = t;
      const s: SignalSample = { tMs: t, sdkConfidenceOk: this.statusOk };
      if (trace !== undefined) s.breathingTrace = trace;
      if (this.talking && t - this.talking.tMs <= this.freshMs) s.talking = this.talking.v;
      if (this.blinking && t - this.blinking.tMs <= this.freshMs) s.blinking = this.blinking.v;
      if (this.statusOk) {
        if (this.rate && t - this.rate.tMs <= this.freshMs) {
          s.breathingRate = this.rate.v.value;
          s.breathingRateConfidence = this.rate.v.confidence;
        }
        if (this.pulse && t - this.pulse.tMs <= this.freshMs) {
          s.pulseBpm = this.pulse.v.value;
          s.pulseConfidence = this.pulse.v.confidence;
        }
        if (this.hrv && t - this.hrv.tMs <= this.freshMs) s.hrv = this.hrv.v;
      }
      out.push(s);
    };

    for (const tr of traces) emit(tr.t, tr.v);
    if (traces.length === 0) {
      // No trace this packet: still deliver talking / slow-signal updates.
      const times = [
        ...talk.map((e) => e.t),
        ...blink.map((e) => e.t),
        this.rate?.tMs,
        this.pulse?.tMs,
        fallbackMs,
      ].filter((x): x is number => typeof x === 'number');
      if (times.length > 0) emit(Math.max(...times), undefined);
    } else {
      // Apply any later talking/blinking entries so the next packet starts current.
      while (ti < talk.length) this.talking = { v: talk[ti].v, tMs: talk[ti++].t };
      while (bi < blink.length) this.blinking = { v: blink[bi].v, tMs: blink[bi++].t };
    }
    return out;
  }
}
