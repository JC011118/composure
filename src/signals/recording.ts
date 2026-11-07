/**
 * Signal recordings: normalized samples + statuses captured from any
 * SignalSource, saved as JSON, and replayed later by ReplaySignalSource.
 *
 * Numbers only. No frames, no video, no audio.
 */

import type { HrvSample, SignalMode, SignalSample, SignalStatus } from '../engine/types';
import type { SignalSource, Unsubscribe } from './SignalSource';

export const RECORDING_FORMAT = 'composure-signal-recording';
export const RECORDING_VERSION = 1;

export interface SignalRecording {
  format: typeof RECORDING_FORMAT;
  version: typeof RECORDING_VERSION;
  /** Which kind of source produced it. */
  source: SignalMode;
  createdAt: string;
  durationMs: number;
  samples: SignalSample[];
  statuses: SignalStatus[];
  /** Free-form notes (scenario, seed, hardware). */
  notes?: string;
}

const r = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Round and drop undefined fields to keep recordings compact and stable. */
export function compactSample(s: SignalSample): SignalSample {
  const out: SignalSample = { tMs: r(s.tMs, 1), sdkConfidenceOk: s.sdkConfidenceOk };
  if (s.breathingTrace !== undefined) out.breathingTrace = r(s.breathingTrace, 5);
  if (s.breathingRate !== undefined) out.breathingRate = r(s.breathingRate, 2);
  if (s.breathingRateConfidence !== undefined) out.breathingRateConfidence = r(s.breathingRateConfidence, 1);
  if (s.pulseBpm !== undefined) out.pulseBpm = r(s.pulseBpm, 2);
  if (s.pulseConfidence !== undefined) out.pulseConfidence = r(s.pulseConfidence, 1);
  if (s.talking !== undefined) out.talking = s.talking;
  if (s.blinking !== undefined) out.blinking = s.blinking;
  if (s.hrv !== undefined) {
    const h: HrvSample = {
      rmssd: r(s.hrv.rmssd, 2),
      sdnn: r(s.hrv.sdnn, 2),
      meanNn: r(s.hrv.meanNn, 2),
      confidence: r(s.hrv.confidence, 1),
      stable: s.hrv.stable,
    };
    if (s.hrv.baevsky !== undefined) h.baevsky = r(s.hrv.baevsky, 2);
    out.hrv = h;
  }
  return out;
}

/**
 * Tap a source and keep everything it emits. Start the tap before
 * `source.start()` to capture from the first sample.
 */
export class RecordingTap {
  private samples: SignalSample[] = [];
  private statuses: SignalStatus[] = [];
  private unsubs: Unsubscribe[];
  private stopped = false;

  constructor(
    private readonly source: SignalSource,
    private readonly maxSamples = 200_000,
  ) {
    this.unsubs = [
      source.onSample((s) => {
        if (!this.stopped && this.samples.length < this.maxSamples) this.samples.push(compactSample(s));
      }),
      source.onStatus((st) => {
        if (!this.stopped) this.statuses.push({ tMs: r(st.tMs, 1), code: st.code, hint: st.hint });
      }),
    ];
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  stop(): void {
    this.stopped = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  toRecording(createdAt: string, notes?: string): SignalRecording {
    const first = this.samples[0]?.tMs ?? 0;
    const last = this.samples[this.samples.length - 1]?.tMs ?? 0;
    return {
      format: RECORDING_FORMAT,
      version: RECORDING_VERSION,
      source: this.source.kind,
      createdAt,
      durationMs: last - first,
      samples: [...this.samples],
      statuses: [...this.statuses],
      ...(notes ? { notes } : {}),
    };
  }

  toJson(createdAt: string, notes?: string): string {
    return JSON.stringify(this.toRecording(createdAt, notes));
  }
}

/** Start capturing a source's samples for later replay. */
export function recordToJson(source: SignalSource, maxSamples?: number): RecordingTap {
  return new RecordingTap(source, maxSamples);
}

/** Parse and validate a recording. Throws with a readable message on bad input. */
export function parseRecording(json: string): SignalRecording {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Recording is not valid JSON');
  }
  const rec = raw as Partial<SignalRecording>;
  if (!rec || rec.format !== RECORDING_FORMAT) throw new Error('Not a Composure signal recording');
  if (rec.version !== RECORDING_VERSION)
    throw new Error(`Unsupported recording version ${String(rec.version)}`);
  if (!Array.isArray(rec.samples) || rec.samples.length === 0) throw new Error('Recording has no samples');
  let prev = Number.NEGATIVE_INFINITY;
  for (const s of rec.samples) {
    if (typeof s?.tMs !== 'number' || !Number.isFinite(s.tMs) || typeof s.sdkConfidenceOk !== 'boolean') {
      throw new Error('Recording contains a malformed sample');
    }
    if (s.tMs < prev) throw new Error('Recording samples are not in time order');
    prev = s.tMs;
  }
  return {
    format: RECORDING_FORMAT,
    version: RECORDING_VERSION,
    source: (rec.source as SignalMode) ?? 'replay',
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
    durationMs: typeof rec.durationMs === 'number' ? rec.durationMs : prev - rec.samples[0].tMs,
    samples: rec.samples,
    statuses: Array.isArray(rec.statuses) ? rec.statuses : [],
    ...(typeof rec.notes === 'string' ? { notes: rec.notes } : {}),
  };
}
