import { useEffect } from 'react';
import type { EngineSnapshot, InterviewEngine } from '../../engine/engine';
import { TraceCanvas } from '../components/TraceCanvas';
import { useController, useStore } from '../runtime/hooks';

function listeningLine(snap: EngineSnapshot, cameraFree: boolean): { on: boolean; text: string } {
  const l = snap.listening;
  if (snap.phase === 'asking') return { on: false, text: 'Listen to the question…' };
  if (!l) return { on: false, text: '' };
  if (!l.answerStarted) {
    return {
      on: false,
      text: cameraFree
        ? 'Hold Space (or the button) while you answer.'
        : 'Take a moment, then start whenever you are ready.',
    };
  }
  if (l.talking) return { on: true, text: 'Listening…' };
  const s = l.silenceMs !== null ? Math.floor(l.silenceMs / 1000) : 0;
  if (l.armed)
    return { on: false, text: s >= 1 ? `Paused ${s} s · a longer pause wraps up the answer` : 'Paused' };
  return { on: false, text: s >= 1 ? `Paused ${s} s` : 'Paused' };
}

export function InterviewScreen({ engine, snap }: { engine: InterviewEngine; snap: EngineSnapshot }) {
  const controller = useController();
  const app = useStore(controller.app);
  const cameraFree = snap.cameraFree;
  const q = snap.question;
  const line = listeningLine(snap, cameraFree);

  // Keyboard: Enter = done answering; Space = talking (camera-free only).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // A focused button handles its own Enter; key repeat must not fire twice.
      if (e.key === 'Enter' && !e.repeat && !(e.target instanceof HTMLButtonElement))
        controller.manualEndAnswer();
      if (cameraFree && e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        controller.setManualTalking(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (cameraFree && e.code === 'Space') {
        e.preventDefault();
        controller.setManualTalking(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      if (cameraFree) controller.setManualTalking(false);
    };
  }, [controller, cameraFree]);

  return (
    <main className="screen" data-screen="interview">
      <p className="eyebrow">
        Question {snap.questionIndex + 1} of {snap.questionCount}
        {q ? ` · ${q.tag === 'behavioral' ? 'Behavioral' : 'Technical'}` : ''}
      </p>
      <h1 className="question-text" data-testid="question-text">
        {q?.text}
      </h1>

      <div className="interviewer" aria-live="polite">
        <span className={`voice-dot ${snap.speaking ? 'speaking' : ''}`} />
        <span>
          <span className="muted">Interviewer: </span>
          {snap.interviewerLine ?? ''}
        </span>
      </div>

      <div className="listening" data-testid="listening">
        <span className={`mic ${line.on ? 'on' : ''}`} />
        <span>{line.text}</span>
        <span className="spacer" />
        {snap.listening?.answerElapsedMs !== null && snap.listening?.answerElapsedMs !== undefined ? (
          <span className="muted small">{Math.floor(snap.listening.answerElapsedMs / 1000)} s</span>
        ) : null}
      </div>

      {!cameraFree && (
        <div className="trace-wrap" style={{ marginBottom: 18 }}>
          <span className="trace-label">breathing.upperTrace · live</span>
          <TraceCanvas engine={engine} height={120} />
        </div>
      )}

      <div className="row">
        {cameraFree && (
          <button
            type="button"
            className={`btn big ${app.manualTalking ? 'primary' : ''}`}
            onPointerDown={() => controller.setManualTalking(true)}
            onPointerUp={() => controller.setManualTalking(false)}
            onPointerLeave={() => app.manualTalking && controller.setManualTalking(false)}
          >
            {app.manualTalking ? 'Speaking…' : 'Hold while speaking'}
            <span className="kbd">Space</span>
          </button>
        )}
        <button
          type="button"
          className="btn big"
          onClick={() => controller.manualEndAnswer()}
          data-testid="done-answering"
        >
          {snap.phase === 'asking' ? 'Skip to answering' : 'Done answering'}
          <span className="kbd">Enter</span>
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => controller.endSessionEarly()}>
          End session
        </button>
      </div>
    </main>
  );
}
