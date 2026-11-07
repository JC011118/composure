/**
 * Where a session's numbers came from, stamped on everything that can leave
 * the HUD's sight (debrief, saved sessions, PNG cards) so simulated or replayed
 * values are never presented as a live SmartSpectra measurement.
 */

import type { SignalMode } from '../../engine/types';

export function provenanceLabel(mode: SignalMode, replayOf?: SignalMode): string | null {
  switch (mode) {
    case 'real':
      return null;
    case 'simulated':
      return 'SIMULATED · synthetic signals, not a measurement';
    case 'camera-free':
      return 'CAMERA OFF · timing only, no physiological signals';
    case 'replay':
      return replayOf === 'real'
        ? 'REPLAY · recorded SmartSpectra signals'
        : replayOf === 'simulated'
          ? 'REPLAY OF A SIMULATED SESSION · synthetic signals, not a measurement'
          : 'REPLAY · recorded signals';
    default:
      return null;
  }
}
