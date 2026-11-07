/**
 * Loads the real SmartSpectra SignalSource. Kept behind a dynamic import so
 * simulator, replay, and camera-free modes never load the SDK's renderer code.
 */

import type { SignalSource } from '../../signals/SignalSource';

export interface RealSourceOptions {
  apiKey: string;
  telemetry: boolean;
}

export async function loadRealSource(_opts: RealSourceOptions): Promise<SignalSource> {
  throw new Error('Real SDK mode is not wired in this build yet. Run with --sim.');
}
