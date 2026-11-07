/**
 * Simulator-mode SignalSource. Wraps the seeded SimPerson with a clock.
 *
 * - `start()` runs in real time (scaled by `speed`) using timers.
 * - `stepTo(tMs)` advances deterministically with no timers (tests, headless runs).
 */

import type { EngineEvent, SignalSample, SignalStatus } from '../engine/types';
import { Emitter, type SignalSource, type SourceError, type Unsubscribe } from './SignalSource';
import { SimPerson, type SimPersonOptions } from './sim/model';

export interface SimulatedSourceOptions extends SimPersonOptions {
  /** Time compression for real-time runs (1 = real time). */
  speed?: number;
  /** Timer granularity for real-time runs. */
  tickMs?: number;
  /** Clock used for real-time runs; injectable for tests. */
  wallClock?: () => number;
}

export class SimulatedSignalSource implements SignalSource {
  readonly kind = 'simulated' as const;
  readonly person: SimPerson;
  private readonly samples = new Emitter<SignalSample>();
  private readonly statuses = new Emitter<SignalStatus>();
  private readonly errors = new Emitter<SourceError>();
  private readonly stepMs: number;
  private readonly speed: number;
  private readonly tickMs: number;
  private readonly wallClock: () => number;
  private nextT = 0;
  private simNow = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wallStart = 0;
  private simAtStart = 0;

  constructor(opts: SimulatedSourceOptions) {
    this.person = new SimPerson(opts);
    this.stepMs = 1000 / this.person.sampleRateHz;
    this.speed = opts.speed ?? 1;
    this.tickMs = opts.tickMs ?? 50;
    this.wallClock = opts.wallClock ?? (() => performance.now());
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

  /** Emit every sample with tMs ≤ t. Deterministic. */
  stepTo(t: number): void {
    while (this.nextT <= t) {
      const frame = this.person.generate(this.nextT);
      if (frame.status) this.statuses.emit(frame.status);
      this.samples.emit(frame.sample);
      this.nextT = Math.round((this.nextT + this.stepMs) * 1000) / 1000;
    }
    this.simNow = Math.max(this.simNow, t);
  }

  observeEngine(event: EngineEvent): void {
    this.person.observe(event);
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
