/**
 * Persistent HUD: a slim monospace strip along the bottom of every screen with
 * the raw SmartSpectra field names and their current values, a signal-quality
 * chip driven by validationStatus, and an always-visible mode badge so a
 * simulated value is never mistaken for a measurement.
 */

import { redactBannedTerms } from '../../engine/lexicon';
import { validationLabel } from '../../shared/validation';
import { useController, useStore } from '../runtime/hooks';

const MODE_BADGE: Record<string, { text: string; cls: string; note: string }> = {
  real: { text: 'SDK LIVE', cls: 'real', note: '@smartspectra/node-sdk' },
  simulated: { text: 'SIMULATED', cls: 'sim', note: 'synthetic signals, not a measurement' },
  replay: { text: 'REPLAY', cls: 'sim', note: 'recorded signals' },
  'camera-free': { text: 'CAMERA OFF', cls: 'sim', note: 'no physiological signals' },
  idle: { text: 'IDLE', cls: '', note: 'camera not started' },
};

const fmt = (v: number | null, digits: number) => (v === null ? '—' : v.toFixed(digits));

export function Hud() {
  const controller = useController();
  const hud = useStore(controller.hud);
  const app = useStore(controller.app);
  const badge = MODE_BADGE[hud.mode] ?? MODE_BADGE.idle;
  const status = hud.status;
  const ok = status ? status.code === 0 : hud.sdkConfidenceOk;
  const label = status ? validationLabel(status.code) : null;
  const hint = status && status.code !== 0 && status.hint ? redactBannedTerms(status.hint) : null;

  return (
    <footer className="hud" aria-label="SmartSpectra signal HUD" data-testid="hud">
      <span className="hud-item">
        <span className={`badge ${badge.cls}`}>{badge.text}</span> <span className="k">{badge.note}</span>
      </span>
      <span className="hud-item">
        <span className="k">face.talking.detected</span>{' '}
        <span className="v">{hud.talking === null ? '—' : String(hud.talking)}</span>
      </span>
      <span className="hud-item">
        <span className="k">breathing.rate</span> <span className="v">{fmt(hud.breathingRate, 1)}/min</span>
        {hud.breathingRateConfidence !== null ? (
          <span className="k"> conf {hud.breathingRateConfidence.toFixed(0)}</span>
        ) : null}
      </span>
      <span className="hud-item">
        <span className="k">cardio.pulseRate</span> <span className="v">{fmt(hud.pulseBpm, 0)} bpm</span>
        {hud.pulseConfidence !== null ? (
          <span className="k"> conf {hud.pulseConfidence.toFixed(0)}</span>
        ) : null}
      </span>
      <span className="hud-item">
        <span className="k">validationStatus</span>{' '}
        <span className="quality">
          <span className={`q-dot ${ok === null ? '' : ok ? 'ok' : 'bad'}`} />
          <span className="v">{label ? label.name : '—'}</span>
        </span>
        {hint ? <span className="hint"> {hint}</span> : null}
      </span>
      {app.cameraActive ? (
        <span className="hud-item cam">
          <span className="rec-dot" /> camera on · frames stay in memory
        </span>
      ) : null}
    </footer>
  );
}
