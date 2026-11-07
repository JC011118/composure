import { useCallback, useEffect, useState } from 'react';
import type { EngineSnapshot, InterviewEngine } from '../../engine/engine';
import type { OutReason } from '../../engine/gate';
import { cardHeadline, renderRecoveredCard } from '../components/cardPng';
import { TraceCanvas, type BandOverlay } from '../components/TraceCanvas';
import { WaterSurface, type WaterState } from '../components/WaterSurface';
import { useController } from '../runtime/hooks';

function reasonText(reason: OutReason | null, snap: EngineSnapshot): string {
  const g = snap.gate?.status;
  const band = snap.gate?.band;
  switch (reason) {
    case null:
      return 'Inside your band';
    case 'gap':
      return 'Signal gap — hold still and face the camera';
    case 'no-data':
      return 'Waiting for the signal';
    case 'no-cycle':
      return 'Reading your breath…';
    case 'held':
      return 'Breath held — just breathe normally';
    case 'excursion':
      return 'A big breath — let it settle';
    case 'period':
      if (g?.latest && band) {
        return g.latest.periodMs < band.periodLoMs
          ? 'Breaths are quicker than your seated band'
          : 'Breaths are slower than your seated band';
      }
      return 'Breath timing is outside your band';
    case 'amplitude':
      if (g?.latest && band) {
        return g.latest.amplitude > band.ampHi
          ? 'Breaths are deeper than your seated band'
          : 'Breaths are shallower than your seated band';
      }
      return 'Breath depth is outside your band';
    default:
      return '';
  }
}

export function GateScreen({ engine, snap }: { engine: InterviewEngine; snap: EngineSnapshot }) {
  const controller = useController();
  const [saved, setSaved] = useState<string | null>(null);
  const gate = snap.gate;
  const status = gate?.status ?? null;
  const result = gate?.result ?? null;
  const paced = gate?.paced ?? false;
  const qResult = result ? snap.results[snap.results.length - 1] : null;
  const isLast = snap.questionIndex + 1 >= snap.questionCount;

  useEffect(() => setSaved(null), [snap.questionIndex]);

  const bandOverlay = useCallback((): BandOverlay | null => {
    const g = engine.getSnapshot().gate;
    if (!g?.band || !g.status) return null;
    return { center: g.status.center, ampLo: g.band.ampLo, ampHi: g.band.ampHi, inBand: g.status.inBand };
  }, [engine]);

  const waterState = useCallback((): WaterState => {
    const g = engine.getSnapshot().gate;
    if (!g) return { intensity: 0.4, breath: null, still: false };
    if (g.result) return { intensity: 0, breath: null, still: true };
    if (g.paced) {
      const left = g.pacedRemainingMs ?? 0;
      return {
        intensity: Math.min(1, left / engine.config.cameraFree.pauseMs) * 0.6,
        breath: null,
        still: false,
      };
    }
    const st = g.status;
    const band = g.band;
    const dev = st?.deviation ?? 1.6;
    const intensity = Math.min(1, Math.max(0.08, dev / 2)) * (1 - 0.85 * (st?.holdProgress ?? 0));
    let breath: number | null = null;
    if (
      st?.smoothed !== null &&
      st?.smoothed !== undefined &&
      st.center !== null &&
      band &&
      Number.isFinite(band.ampHi)
    ) {
      breath = Math.max(-1.5, Math.min(1.5, (st.smoothed - st.center) / (band.ampHi / 2)));
    }
    return {
      intensity,
      breath,
      still: false,
      breathKey: st?.latest?.tMs ?? null,
      breathSize: Math.min(1, Math.max(0, dev / 2)),
      hold: st?.holdProgress ?? 0,
    };
  }, [engine]);

  const saveCard = async () => {
    if (!qResult) return;
    const date = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const png = renderRecoveredCard(qResult, snap.questionCount, date, engine.config.gate);
    const res = await controller.savePng(png, `composure-q${qResult.index + 1}-recovery.png`);
    setSaved(res?.ok ? `Saved to ${res.path}` : res?.cancelled ? null : 'Could not save the card');
  };

  const elapsed = status ? status.elapsedMs : snap.phaseElapsedMs;
  const timeout = engine.config.gate.timeoutMs;
  const hold = engine.config.gate.holdMs;

  return (
    <main className="screen" data-screen="gate">
      <p className="eyebrow">
        Composure Gate ·{' '}
        {isLast
          ? 'before your debrief'
          : `before question ${snap.questionIndex + 2} of ${snap.questionCount}`}
      </p>
      <h1 className="headline">
        {paced ? 'Take a slow, even pause' : 'Let your breathing settle back into your band'}
      </h1>

      <div className="gate-hero" data-testid="gate-hero">
        <WaterSurface height={440} state={waterState} surface={paced ? 0.45 : 0.66} />
        {!paced && (
          <div className="trace-layer" style={{ bottom: '34%' }}>
            <TraceCanvas
              engine={engine}
              height={290}
              windowMs={16_000}
              band={bandOverlay}
              transparent
              showTalking={false}
              lineWidth={3}
            />
          </div>
        )}
        {result && qResult && (
          <div className="recovered-overlay">
            <div className="recovered-card" data-testid="recovered-card">
              <p className="eyebrow">Question {qResult.index + 1}</p>
              <div className={`value ${result.outcome === 'settled' ? '' : 'timed'}`}>
                {cardHeadline(qResult)}
              </div>
              <p className="muted" style={{ margin: '0 0 22px' }}>
                {result.outcome === 'settled'
                  ? `Back inside your seated band, then held for ${(hold / 1000).toFixed(0)} s.`
                  : result.outcome === 'timed out'
                    ? `The Gate opened at its ${(timeout / 1000).toFixed(0)} s limit.`
                    : 'No measurement for this pause.'}
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn" onClick={() => void saveCard()} data-testid="save-card">
                  Save card as PNG
                </button>
                <button type="button" className="btn primary" onClick={() => controller.continueAfterGate()}>
                  {isLast ? 'See debrief' : 'Next question'}
                  {gate?.dwellRemainingMs !== null && gate?.dwellRemainingMs !== undefined
                    ? ` · ${Math.ceil(gate.dwellRemainingMs / 1000)} s`
                    : ''}
                </button>
              </div>
              {saved && (
                <p className="muted small" style={{ marginTop: 14 }}>
                  {saved}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {!result && (
        <>
          <div className="gate-status">
            <span className="big" data-testid="gate-reason">
              {paced
                ? `${Math.ceil((gate?.pacedRemainingMs ?? 0) / 1000)} s`
                : reasonText(status?.outReason ?? 'no-data', snap)}
            </span>
            {!paced && status?.inBand && (
              <span className="muted">
                holding {(status.streakMs / 1000).toFixed(1)} / {(hold / 1000).toFixed(0)} s
              </span>
            )}
            <span className="spacer" />
            <span className="muted small">
              {Math.floor(elapsed / 1000)} s
              {paced ? '' : ` · opens anyway at ${(timeout / 1000).toFixed(0)} s`}
            </span>
          </div>
          {!paced && (
            <div className="hold-bar" aria-label="Hold progress">
              <div style={{ width: `${((status?.holdProgress ?? 0) * 100).toFixed(1)}%` }} />
            </div>
          )}
          {!paced && gate?.band && !gate.band.personal && (
            <p className="muted small">
              Your seated baseline had too few clean breaths, so this Gate uses a wide default band.
            </p>
          )}
          <div className="row" style={{ marginTop: 22 }}>
            <span className="muted small">
              The band is your own seated breathing: period and depth within{' '}
              {engine.config.gate.bandSdMultiplier} SD of your baseline.
            </span>
            <span className="spacer" />
            <button type="button" className="btn ghost" onClick={() => controller.skipGate()}>
              Skip
            </button>
            <button type="button" className="btn ghost" onClick={() => controller.endSessionEarly()}>
              End session
            </button>
          </div>
        </>
      )}
    </main>
  );
}
