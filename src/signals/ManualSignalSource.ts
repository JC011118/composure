/**
 * Camera-free mode. No camera, no SDK, no physiology: the only signal is
 * "talking", toggled by the user (Space bar or the on-screen button). Samples
 * carry sdkConfidenceOk=false so nothing physiological is ever computed or
 * shown; the engine replaces the Gate with a fixed paced pause.
 */

import type { SignalSample, SignalStatus } from '../engine/types';
import { Emitter, type SignalSource, type SourceError, type Unsubscribe } from './SignalSource';

export class ManualSignalSource implements SignalSource {
  readonly kind = 'camera-free' as const;
  private readonly samples = new Emitter<SignalSample>();
  private readonly statuses = new Emitter<SignalStatus>();
  private readonly errors = new Emitter<SourceError>();
  private talking = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wallStart = 0;
  private stoppedAt = 0;

  constructor(
    private readonly wallClock: () => number = () => performance.now(),
    private readonly rateHz = 10,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.wallStart = this.wallClock() - this.stoppedAt;
    this.timer = setInterval(() => this.emitNow(), 1000 / this.rateHz);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stoppedAt = this.now();
  }

  now(): number {
    return this.timer ? this.wallClock() - this.wallStart : this.stoppedAt;
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
    if (this.timer) this.emitNow();
  }

  isTalking(): boolean {
    return this.talking;
  }

  /** Emit one sample at an explicit time (tests). */
  emitAt(tMs: number): void {
    this.samples.emit({ tMs, talking: this.talking, sdkConfidenceOk: false });
  }

  private emitNow(): void {
    this.emitAt(this.now());
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
