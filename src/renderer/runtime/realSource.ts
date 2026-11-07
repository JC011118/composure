/**
 * Loads the real SmartSpectra SignalSource. Kept behind a dynamic import so
 * simulator, replay, and camera-free modes never load the SDK's renderer code.
 */

import type { SignalSource } from '../../signals/SignalSource';

export interface RealSourceOptions {
  apiKey: string;
  telemetry: boolean;
}

export async function loadRealSource(opts: RealSourceOptions): Promise<SignalSource> {
  const { PresageSignalSource } = await import('../../signals/PresageSignalSource');
  return new PresageSignalSource({ apiKey: opts.apiKey, telemetry: opts.telemetry });
}
