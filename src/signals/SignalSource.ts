/**
 * The one interface every signal provider implements. The engine only ever
 * sees normalized `SignalSample`s and `SignalStatus`es from here.
 *
 * Implementations:
 *   - PresageSignalSource   real SmartSpectra SDK (the ONLY file that touches SDK APIs)
 *   - SimulatedSignalSource synthetic person with tunable noise, reacts to the interview
 *   - ReplaySignalSource    plays a recorded JSON session back
 *   - ManualSignalSource    camera-free mode: talking from the keyboard, no physiology
 */

import type { EngineEvent, SignalMode, SignalSample, SignalStatus } from '../engine/types';

export type Unsubscribe = () => void;

export interface SourceError {
  message: string;
  /** SDK error code when available. */
  code?: number;
  /** True if the source cannot continue. */
  fatal: boolean;
}

/** LLM Insights capability (real mode only, opt-in). */
export interface InsightReply {
  requestId: number;
  processedAt: string;
  analysis?: string;
  error?: string;
}

export interface InsightChannel {
  request(prompt: string): Promise<number>;
  onReply(listener: (reply: InsightReply) => void): Unsubscribe;
}

export interface SignalSource {
  readonly kind: SignalMode;
  /** Begin producing samples. Real mode acquires the camera here, never earlier. */
  start(): Promise<void>;
  /** Stop producing samples and release any device. Idempotent. */
  stop(): Promise<void>;
  /** Current time on this source's clock, in the same base as sample.tMs. */
  now(): number;
  onSample(listener: (sample: SignalSample) => void): Unsubscribe;
  onStatus(listener: (status: SignalStatus) => void): Unsubscribe;
  onError(listener: (error: SourceError) => void): Unsubscribe;
  /** Optional: lets the simulator react to the interview (who is talking, when). */
  observeEngine?(event: EngineEvent): void;
  /** Optional: camera preview for the UI (real mode). */
  onPreviewStream?(listener: (stream: MediaStream) => void): Unsubscribe;
  /** Optional: LLM Insights (real mode, opt-in). */
  readonly insights?: InsightChannel;
}

/** Minimal typed event hub used by the source implementations. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const l of this.listeners) {
      try {
        l(value);
      } catch (err) {
        console.error('[composure] signal listener threw', err);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
