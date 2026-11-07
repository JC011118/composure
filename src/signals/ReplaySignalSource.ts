/**
 * Replays a recorded session (see recording.ts). Sample times are re-based so
 * the first sample is at t = 0. After the last sample the clock keeps running
 * (so a Gate can still time out) but no more samples arrive.
 */

import type { SignalMode, SignalSample, SignalStatus } from '../engine/types';
import { Emitter, type SignalSource, type SourceError, type Unsubscribe } from './SignalSource';
import type { SignalRecording } from './recording';

export interface ReplayOptions {
  /** Time subtracted from recorded times (default: the first sample's time). */
  timeBaseMs?: number;
  speed?: number;
  tickMs?: number;
  wallClock?: () => number;
}

export class ReplaySignalSource implements SignalSource {
  readonly kind = 'replay' as const;
  /** What originally produced the recording (kept when a replay is re-recorded). */
  readonly origin: SignalMode;
  private readonly samples = new Emitter<SignalSample>();
  private readonly statuses = new Emitter<SignalStatus>();
  private readonly errors = new Emitter<SourceError>();
  private readonly ended = new Emitter<void>();
  private readonly t0: number;
  private sampleIdx = 0;
  private statusIdx = 0;
  private simNow = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wallStart = 0;
  private simAtStart = 0;
  private endedEmitted = false;
  private readonly speed: number;
  private readonly tickMs: number;
  private readonly wallClock: () => number;

  constructor(
    private readonly recording: SignalRecording,
    opts: ReplayOptions = {},
  ) {
    this.t0 = opts.timeBaseMs ?? recording.samples[0]?.tMs ?? 0;
    this.origin = recording.source;
    this.speed = opts.speed ?? 1;
    this.tickMs = opts.tickMs ?? 50;
    this.wallClock = opts.wallClock ?? (() => performance.now());
  }

  get durationMs(): number {
    const last = this.recording.samples[this.recording.samples.length - 1];
    return last ? last.tMs - this.t0 : 0;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.wallStart = this.wallClock();
    this.simAtStart = this.simNow;
    this.timer = setInterval(() => {
      this.stepTo(this.simAtStart + (this.wallClock() - this.wallStart) * this.speed);
    }, this.tickMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  now(): number {
    if (this.timer) return this.simAtStart + (this.wallClock() - this.wallStart) * this.speed;
    return this.simNow;
  }

  stepTo(t: number): void {
    const { samples, statuses } = this.recording;
    while (this.sampleIdx < samples.length && samples[this.sampleIdx].tMs - this.t0 <= t) {
      const s = samples[this.sampleIdx++];
      const rt = s.tMs - this.t0;
      while (this.statusIdx < statuses.length && statuses[this.statusIdx].tMs - this.t0 <= rt) {
        const st = statuses[this.statusIdx++];
        this.statuses.emit({ ...st, tMs: st.tMs - this.t0 });
      }
      this.samples.emit({ ...s, tMs: rt });
    }
    this.simNow = Math.max(this.simNow, t);
    if (!this.endedEmitted && this.sampleIdx >= samples.length) {
      this.endedEmitted = true;
      this.ended.emit();
    }
  }

  /** Time offset subtracted from recorded times (the first sample's time). */
  get timeBaseMs(): number {
    return this.t0;
  }

  get emittedCount(): number {
    return this.sampleIdx;
  }

  get sampleCount(): number {
    return this.recording.samples.length;
  }

  /** Emit exactly the next sample (with any statuses due before it). Returns false at the end. */
  stepOne(): boolean {
    const { samples, statuses } = this.recording;
    if (this.sampleIdx >= samples.length) return false;
    const s = samples[this.sampleIdx++];
    const rt = s.tMs - this.t0;
    while (this.statusIdx < statuses.length && statuses[this.statusIdx].tMs - this.t0 <= rt) {
      const st = statuses[this.statusIdx++];
      this.statuses.emit({ ...st, tMs: st.tMs - this.t0 });
    }
    this.samples.emit({ ...s, tMs: rt });
    this.simNow = Math.max(this.simNow, rt);
    return true;
  }

  onEnded(listener: () => void): Unsubscribe {
    return this.ended.on(listener);
  }

  onSample(listener: (sample: SignalSample) => void): Unsubscribe {
    return this.samples.on(listener);
  }

  onStatus(listener: (status: SignalStatus) => void): Unsubscribe {
    return this.statuses.on(listener);
  }

  onError(listener: (error: SourceError) => void): Unsubscribe {
    return this.errors.on(listener);
  }
}
