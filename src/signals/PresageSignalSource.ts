/**
 * Real-mode SignalSource backed by the SmartSpectra SDK (renderer entry,
 * MediaStream input). THIS IS THE ONLY RENDERER FILE THAT TOUCHES SDK APIs.
 *
 * The SDK's renderer class acquires the front camera on `start()`, extracts
 * frames in memory, and ships them over a MessagePort to the main-process SDK
 * (wired by `bindSmartSpectraIpc` in src/main/sdkBridge.ts). Metrics come back
 * as protobuf buffers, decoded with `@smartspectra/node-sdk/messages`
 * (renderer-safe), and normalized by MetricsNormalizer. Frames are never
 * stored or sent anywhere by Composure.
 *
 * Signatures used here were checked against the bundled typings of
 * @smartspectra/node-sdk@3.4.0 (js/renderer/index.d.ts, js/messages/index.d.ts).
 */

import {
  SmartSpectraSDK,
  MetricType,
  SmartSpectraErrorCode,
  ProcessingStatus,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { SignalSample, SignalStatus } from '../engine/types';
import { decodeInsight } from './insightCodec';
import { MetricsNormalizer, type DecodedMetricsLike } from './presageNormalize';
import {
  Emitter,
  type InsightChannel,
  type InsightReply,
  type SignalSource,
  type SourceError,
  type Unsubscribe,
} from './SignalSource';

export interface PresageSourceOptions {
  apiKey: string;
  /** Aggregate SDK telemetry (SDK default true). */
  telemetry: boolean;
  /** Clock for the source time base (epoch ms). */
  clock?: () => number;
}

/**
 * Hand-picked metric codes (DECISIONS.md D-004): breathing trace + rate,
 * pulse rate, HRV, talking, blinking. No expressions, no landmarks.
 */
export const REQUESTED_METRICS: number[] = [
  MetricType.CHEST_BREATHING,
  MetricType.ABDOMEN_BREATHING,
  MetricType.BREATHING_RATE,
  MetricType.PULSE_RATE,
  MetricType.HRV,
  MetricType.TALKING,
  MetricType.BLINKING,
];

const FATAL_CODES = new Set<number>([
  SmartSpectraErrorCode.kAuthenticationFailed,
  SmartSpectraErrorCode.kConfigurationFailed,
  SmartSpectraErrorCode.kCreditExhausted,
  SmartSpectraErrorCode.kInputUnavailable,
]);

/** Errors that end the session if they arrive before any metrics did (the SDK never got going). */
const FATAL_BEFORE_METRICS = new Set<number>([
  SmartSpectraErrorCode.kNetworkError,
  SmartSpectraErrorCode.kServerError,
  SmartSpectraErrorCode.kProcessingFailed,
]);

/** Plain-language explanation of an SDK error code (never includes the API key). */
export function describeSdkError(code: number, sdkMessage: string): string {
  const E = SmartSpectraErrorCode;
  const text: Record<number, string> = {
    [E.kAuthenticationFailed]: 'Presage rejected the API key. Check PRESAGE_API_KEY.',
    [E.kCreditExhausted]: 'The SmartSpectra subscription for this API key has no credit left.',
    [E.kNetworkError]:
      "SmartSpectra could not reach Presage's server to validate the API key (network error). Check the internet connection or firewall and try again.",
    [E.kServerError]: "Presage's server returned an error. Try again in a moment.",
    [E.kInputUnavailable]: 'The camera is unavailable or in use by another app.',
    [E.kConfigurationFailed]: 'The SmartSpectra SDK rejected its configuration.',
    [E.kProcessingFailed]: 'SmartSpectra processing failed to start.',
  };
  return `${text[code] ?? sdkMessage} (SDK error ${code})`;
}

export class PresageSignalSource implements SignalSource {
  readonly kind = 'real' as const;
  private readonly samples = new Emitter<SignalSample>();
  private readonly statuses = new Emitter<SignalStatus>();
  private readonly errors = new Emitter<SourceError>();
  private readonly previews = new Emitter<MediaStream>();
  private readonly replies = new Emitter<InsightReply>();
  private readonly clock: () => number;
  private sdk: SmartSpectraSDK | null = null;
  private origin = 0;
  private normalizer: MetricsNormalizer;
  private lastStatusCode = -1;
  private running = false;
  private gotMetrics = false;
  /** In-flight teardown; every stop() caller waits for the same full teardown. */
  private stopping: Promise<void> | null = null;
  readonly insights: InsightChannel;

  constructor(private readonly opts: PresageSourceOptions) {
    this.clock = opts.clock ?? (() => Date.now());
    this.normalizer = new MetricsNormalizer({ originEpochMs: this.clock() });
    this.insights = {
      request: async (prompt: string) => {
        if (!this.sdk) throw new Error('SDK is not running');
        return this.sdk.requestInsight(prompt);
      },
      onReply: (listener) => this.replies.on(listener),
    };
  }

  async start(): Promise<void> {
    if (this.sdk) return;
    this.origin = this.clock();
    this.normalizer = new MetricsNormalizer({ originEpochMs: this.origin });
    const sdk = new SmartSpectraSDK({
      apiKey: this.opts.apiKey,
      requestedMetrics: REQUESTED_METRICS,
      enableTelemetry: this.opts.telemetry,
    });
    this.sdk = sdk;

    sdk.on('streamAvailable', (stream) => this.previews.emit(stream));
    sdk.on('processingStatus', (status) => {
      this.running = status === ProcessingStatus.kRunning;
      if (!this.running) this.normalizer.setStatusOk(false);
    });
    sdk.on('validationStatus', (code, timestampUs, hint) => {
      this.normalizer.setStatusOk(code === 0);
      if (code === this.lastStatusCode) return; // debounce identical statuses (SDK guidance)
      this.lastStatusCode = code;
      const tMs = timestampUs > 0 ? this.normalizer.toMs(timestampUs) : this.now();
      this.statuses.emit({ tMs, code, hint: hint ?? '' });
    });
    sdk.on('metrics', (buf, timestampUs) => {
      let decoded: DecodedMetricsLike;
      try {
        decoded = decodeMetrics(buf) as unknown as DecodedMetricsLike;
      } catch (err) {
        console.warn('[composure] could not decode a metrics packet', err);
        return;
      }
      this.gotMetrics = true;
      for (const s of this.normalizer.ingest(decoded, timestampUs)) this.samples.emit(s);
    });
    sdk.on('insight', (buf, requestId) => {
      try {
        const d = decodeInsight(buf);
        this.replies.emit({
          requestId: d.requestId ?? requestId,
          processedAt: d.processedAt,
          ...(d.analysis !== null ? { analysis: d.analysis } : {}),
          ...(d.error !== null ? { error: d.error } : {}),
        });
      } catch (err) {
        console.warn('[composure] could not decode an insight packet', err);
      }
    });
    sdk.on('error', (code, message) => {
      this.errors.emit({
        code,
        message: describeSdkError(code, message),
        fatal: FATAL_CODES.has(code) || (!this.gotMetrics && FATAL_BEFORE_METRICS.has(code)),
      });
    });

    try {
      await sdk.start();
    } catch (err) {
      const e = err as { message?: string; code?: number | string };
      this.sdk = null;
      try {
        sdk.destroy();
      } catch {
        /* already gone */
      }
      throw new Error(
        `SmartSpectra could not start: ${e.message ?? String(err)}${e.code !== undefined ? ` (code ${e.code})` : ''}`,
        { cause: err },
      );
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const sdk = this.sdk;
    if (!sdk) return;
    this.sdk = null;
    this.running = false;
    this.normalizer.setStatusOk(false);
    this.stopping = (async () => {
      try {
        await sdk.stop(); // releases the SDK-acquired camera; can take seconds to drain
      } catch (err) {
        console.warn('[composure] SDK stop failed', err);
      }
      try {
        sdk.destroy();
      } catch {
        /* idempotent */
      }
    })();
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
    }
  }

  now(): number {
    return this.clock() - this.origin;
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

  onPreviewStream(listener: (stream: MediaStream) => void): Unsubscribe {
    return this.previews.on(listener);
  }
}
