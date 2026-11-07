/**
 * Persistent HUD: raw SmartSpectra field names with their current values, a
 * signal-quality chip driven by validationStatus, and an always-visible mode
 * badge so a simulated value is never mistaken for a measurement.
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
  const mode = hud.mode === 'idle' && app.boot ? 'idle' : hud.mode;
  const badge = MODE_BADGE[mode] ?? MODE_BADGE.idle;
  const status = hud.status;
  const ok = status ? status.code === 0 : hud.sdkConfidenceOk;
  const label = status ? validationLabel(status.code) : null;

  return (
    <aside className="hud" aria-label="SmartSpectra signal HUD" data-testid="hud">
      <div className="mode">
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
        <span className="k">{badge.note}</span>
      </div>
      <div className="hud-row">
        <span className="k">face.talking.detected</span>
        <span className="v">{hud.talking === null ? '—' : String(hud.talking)}</span>
      </div>
      <div className="hud-row">
        <span className="k">breathing.rate</span>
        <span className="v">
          {fmt(hud.breathingRate, 1)} /min
          {hud.breathingRateConfidence !== null ? ` · conf ${hud.breathingRateConfidence.toFixed(0)}` : ''}
        </span>
      </div>
      <div className="hud-row">
        <span className="k">cardio.pulseRate</span>
        <span className="v">
          {fmt(hud.pulseBpm, 0)} bpm
          {hud.pulseConfidence !== null ? ` · conf ${hud.pulseConfidence.toFixed(0)}` : ''}
        </span>
      </div>
      <div className="hud-row">
        <span className="k">validationStatus</span>
        <span className="quality">
          <span className={`q-dot ${ok === null ? '' : ok ? 'ok' : 'bad'}`} />
          <span className="v">{label ? `${label.name}` : '—'}</span>
        </span>
      </div>
      {status && status.code !== 0 && status.hint ? (
        <div className="hud-row">
          <span className="hint">{redactBannedTerms(status.hint)}</span>
        </div>
      ) : null}
      {app.cameraActive ? (
        <div className="hud-row">
          <span className="k">camera</span>
          <span className="v">on · frames stay in memory</span>
        </div>
      ) : null}
    </aside>
  );
}
