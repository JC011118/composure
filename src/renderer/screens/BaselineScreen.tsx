import { useEffect, useRef } from 'react';
import type { EngineSnapshot, InterviewEngine } from '../../engine/engine';
import { redactBannedTerms } from '../../engine/lexicon';
import { READING_PASSAGE } from '../../content';
import { TraceCanvas } from '../components/TraceCanvas';
import { useController, useStore } from '../runtime/hooks';

function Preview() {
  const controller = useController();
  const stream = useStore(controller.preview);
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  if (!stream) return null;
  return <video ref={ref} className="preview-video" autoPlay playsInline muted aria-label="Camera preview" />;
}

export function BaselineScreen({ engine, snap }: { engine: InterviewEngine; snap: EngineSnapshot }) {
  const controller = useController();
  const phase = snap.phase;
  const status = snap.lastStatus;

  let eyebrow: string;
  let title: string;
  let body: string;
  let progress = 0;
  let remaining: number | null = null;
  if (phase === 'signalCheck' && snap.signalCheck) {
    eyebrow = 'Step 1 of 3 · Signal check';
    title = 'Getting a clean signal';
    body =
      'Sit facing the camera with your face and upper chest in view, in even light. Hold still for a few seconds.';
    progress = Math.min(1, snap.signalCheck.okMs / snap.signalCheck.neededMs);
  } else if (phase === 'baselineSeated' && snap.baseline) {
    eyebrow = 'Step 2 of 3 · Seated baseline';
    title = 'Sit back and breathe as you normally do';
    body =
      'Stay quiet for 30 seconds. This sets your own breathing band — the Gate uses it after every answer.';
    progress = Math.min(1, snap.baseline.elapsedMs / snap.baseline.targetMs);
    remaining = Math.max(0, snap.baseline.targetMs - snap.baseline.elapsedMs);
  } else {
    eyebrow = 'Step 3 of 3 · Talking baseline';
    title = 'Read this aloud at a natural pace';
    body = '';
    if (snap.baseline) {
      progress = Math.min(1, snap.baseline.elapsedMs / snap.baseline.targetMs);
      remaining = Math.max(0, snap.baseline.targetMs - snap.baseline.elapsedMs);
    }
  }

  return (
    <main
      className="screen"
      data-screen={
        phase === 'baselineTalking'
          ? 'baselineTalking'
          : phase === 'baselineSeated'
            ? 'baselineSeated'
            : 'signalCheck'
      }
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="headline">{title}</h1>
          {body && <p className="lede">{body}</p>}
        </div>
        <Preview />
      </div>

      {phase === 'baselineTalking' && <p className="passage">{READING_PASSAGE}</p>}

      <div className="trace-wrap" style={{ marginBottom: 16 }}>
        <span className="trace-label">breathing.upperTrace · live</span>
        <TraceCanvas engine={engine} height={phase === 'baselineTalking' ? 150 : 260} />
      </div>

      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="progress">
            <div style={{ width: `${(progress * 100).toFixed(1)}%` }} />
          </div>
        </div>
        <span className="muted small" style={{ minWidth: 150, textAlign: 'right' }}>
          {remaining !== null ? `${Math.ceil(remaining / 1000)} s left` : `${Math.round(progress * 100)} %`}
          {snap.baseline && snap.baseline.coverage < 0.6 && snap.baseline.elapsedMs > 5_000
            ? ' · signal is patchy'
            : ''}
        </span>
      </div>
      {status && status.code !== 0 && status.hint ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Camera says: {redactBannedTerms(status.hint)}
        </p>
      ) : null}

      <div className="row" style={{ marginTop: 28 }}>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => void controller.leaveSession()}>
          Stop and turn off camera
        </button>
      </div>
    </main>
  );
}
