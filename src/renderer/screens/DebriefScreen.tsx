import { useState } from 'react';
import type { QuestionResult, SessionRecord } from '../../engine/session';
import { renderRecoveredCard } from '../components/cardPng';
import { Sparkline } from '../components/Sparkline';
import { fmtSeconds, fmtSigned, useController, useStore } from '../runtime/hooks';

function Metric({ k, v, sub, na }: { k: string; v: string; sub?: string; na?: boolean }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className={`v ${na ? 'na' : ''}`}>{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

const END_REASON: Record<string, string> = {
  silence: 'ended on a pause',
  manual: 'ended with Done',
  maxLength: 'stopped at the 4 min cap',
  noAnswer: 'no answer detected',
};

function QuestionCard({ q, total, record }: { q: QuestionResult; total: number; record: SessionRecord }) {
  const controller = useController();
  const [saved, setSaved] = useState<string | null>(null);
  const totalMs = q.series.marks.endMs;
  const marks = [
    { atMs: q.series.marks.listenMs, label: 'answer' },
    { atMs: q.series.marks.gateMs, label: 'gate' },
  ];
  const seatedRate = record.baselines.seated?.breathingRate?.mean ?? null;
  const talkingPulse = record.baselines.talking?.pulse?.mean ?? null;
  const cues = q.cues.map((c) => (c.cue === 'A' ? '“Take your time.”' : '“Summarize in one sentence.”'));

  const saveCard = async () => {
    const date = new Date(record.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const res = await controller.savePng(
      renderRecoveredCard(q, total, date, record.config.gate),
      `composure-q${q.index + 1}-recovery.png`,
    );
    setSaved(res?.ok ? `Saved to ${res.path}` : res?.cancelled ? null : 'Could not save the card');
  };

  return (
    <section className="panel qcard" data-testid="debrief-question">
      <div className="row">
        <span className="chip">Q{q.index + 1}</span>
        <span className="chip">{q.tag}</span>
        <span className={`chip ${q.recovery === 'settled' ? 'accent' : 'warm'}`}>recovery: {q.recovery}</span>
        {cues.map((c) => (
          <span key={c} className="chip">
            cue {c}
          </span>
        ))}
        <span className="spacer" />
        <button type="button" className="btn link" onClick={() => void saveCard()}>
          Save card as PNG
        </button>
      </div>
      <h3>{q.text}</h3>
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
        <Metric
          k="Time to first word"
          v={fmtSeconds(q.timeToFirstWordMs)}
          na={q.timeToFirstWordMs === null}
        />
        <Metric k="Talk time" v={fmtSeconds(q.talkTimeMs, 0)} sub={END_REASON[q.endReason]} />
        <Metric k="Pauses ≥ 1.5 s" v={String(q.pauseCount)} />
        <Metric
          k="Recovery"
          v={q.recovery === 'settled' ? fmtSeconds(q.recoveryTimeMs) : q.recovery}
          na={q.recovery !== 'settled'}
          sub={q.recovery === 'settled' ? 'back in seated band' : undefined}
        />
        <Metric
          k="Pulse vs talking baseline"
          v={
            q.pulse.shown && q.pulse.deltaBpm !== null
              ? `${fmtSigned(q.pulse.deltaBpm, 0)} bpm`
              : (q.pulse.reason ?? '—')
          }
          na={!q.pulse.shown}
          sub={
            q.pulse.shown && talkingPulse !== null
              ? `baseline ${talkingPulse.toFixed(0)} bpm · clean ${(q.pulse.coverage * 100).toFixed(0)} %`
              : `clean coverage ${(q.pulse.coverage * 100).toFixed(0)} % (needs 60 %)`
          }
        />
        <Metric
          k="Breathing in silences vs seated"
          v={
            q.breathing.shown && q.breathing.deltaBrPerMin !== null
              ? `${fmtSigned(q.breathing.deltaBrPerMin, 1)} /min`
              : (q.breathing.reason ?? '—')
          }
          na={!q.breathing.shown}
          sub={
            q.breathing.shown && seatedRate !== null
              ? `baseline ${seatedRate.toFixed(1)} /min`
              : `${(q.breathing.silentCoveredMs / 1000).toFixed(0)} s of clean silence`
          }
        />
      </div>
      {q.series.trace.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="trace-wrap" style={{ padding: '6px 0' }}>
            <Sparkline
              series={q.series.trace}
              height={90}
              color="#7ff0dd"
              talk={q.series.talk}
              marks={marks}
              totalMs={totalMs}
            />
          </div>
          <div className="trace-wrap" style={{ padding: '6px 0', marginTop: 8 }}>
            <Sparkline
              series={q.series.pulse}
              height={54}
              color="#fbbf77"
              marks={marks}
              totalMs={totalMs}
              reference={talkingPulse}
            />
          </div>
          <div className="legend">
            <span style={{ ['--sw' as string]: '#7ff0dd' }}>breathing trace</span>
            <span style={{ ['--sw' as string]: '#fbbf77' }}>pulse (confidence ≥ 40) vs talking baseline</span>
            <span style={{ ['--sw' as string]: 'rgba(56,189,248,0.35)' }}>talking</span>
            <span style={{ ['--sw' as string]: 'rgba(125,139,154,0.4)' }}>gap: no clean signal</span>
          </div>
        </div>
      )}
      {saved && <p className="muted small">{saved}</p>}
    </section>
  );
}

export function DebriefView({ record, live }: { record: SessionRecord; live: boolean }) {
  const controller = useController();
  const app = useStore(controller.app);
  const total = record.questions.length;
  const seated = record.baselines.seated;
  const band = record.baselines.band;
  const hrv = record.hrv;
  const insights = live
    ? app.insights
    : { status: record.insights.length ? 'done' : 'off', records: record.insights, message: null };
  const settled = record.questions.filter((q) => q.recovery === 'settled');

  return (
    <main className="screen" data-screen="debrief">
      <p className="eyebrow">
        Debrief · {new Date(record.createdAt).toLocaleString()} ·{' '}
        {record.mode === 'real' ? 'SmartSpectra SDK' : record.mode}
      </p>
      <h1 className="headline">
        {settled.length} of {total} Gates settled
        {settled.length > 0
          ? ` · median recovery ${fmtSeconds(
              settled.map((q) => q.recoveryTimeMs ?? 0).sort((a, b) => a - b)[Math.floor(settled.length / 2)],
            )}`
          : ''}
      </h1>
      <p className="lede" style={{ fontSize: 18 }}>
        Each change below is shown next to the baseline from this session that it is measured against; session
        HRV is shown once as the SDK reports it. Spans without a clean signal are shown as gaps and never
        counted.
      </p>

      <div className="grid-3" style={{ marginBottom: 18 }}>
        <div className="panel">
          <p className="eyebrow">Seated baseline</p>
          {seated?.breath && band ? (
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              Breath period {(seated.breath.periodMeanMs / 1000).toFixed(1)} s ±{' '}
              {(seated.breath.periodSdMs / 1000).toFixed(1)}
              <br />
              Gate band {(band.periodLoMs / 1000).toFixed(1)}–{(band.periodHiMs / 1000).toFixed(1)} s
              {band.personal ? '' : ' (wide default)'}
              <br />
              Depth band{' '}
              {Number.isFinite(band.ampHi)
                ? `${band.ampLo.toFixed(3)}–${band.ampHi.toFixed(3)}`
                : 'not set'}{' '}
              <span className="muted small">(trace units)</span>
              <br />
              Breathing rate {seated.breathingRate ? `${seated.breathingRate.mean.toFixed(1)} /min` : '—'}
            </p>
          ) : (
            <p className="muted">
              {record.mode === 'camera-free' ? 'Camera off: no baseline.' : 'No seated baseline.'}
            </p>
          )}
        </div>
        <div className="panel">
          <p className="eyebrow">Talking baseline</p>
          {record.baselines.talking ? (
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              Pulse{' '}
              {record.baselines.talking.pulse ? `${record.baselines.talking.pulse.mean.toFixed(0)} bpm` : '—'}
              <br />
              Breathing rate{' '}
              {record.baselines.talking.breathingRate
                ? `${record.baselines.talking.breathingRate.mean.toFixed(1)} /min`
                : '—'}
            </p>
          ) : (
            <p className="muted">—</p>
          )}
        </div>
        <div className="panel" data-testid="session-hrv">
          <p className="eyebrow">Session HRV (RMSSD)</p>
          {hrv ? (
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              <span style={{ fontSize: 30, fontWeight: 600 }}>{hrv.rmssd.toFixed(0)} ms</span>
              <br />
              <span className={`chip ${hrv.stable ? 'accent' : 'warm'}`}>stable: {String(hrv.stable)}</span>
              <span className="muted small">confidence {hrv.confidence.toFixed(0)}</span>
            </p>
          ) : (
            <p className="muted">not enough clean signal (needs about a minute of stillness)</p>
          )}
        </div>
      </div>

      {record.questions.map((q) => (
        <QuestionCard key={q.index} q={q} total={total} record={record} />
      ))}
      {record.questions.length === 0 && <p className="muted">No questions were completed.</p>}

      {insights.status !== 'off' && (
        <section className="panel" style={{ marginBottom: 18 }} data-testid="insights">
          <p className="eyebrow">LLM Insights (cloud · opt-in)</p>
          {insights.status === 'unavailable' && (
            <p className="muted">LLM Insights need the real SDK; not available in this mode.</p>
          )}
          {(insights.status === 'requesting' || insights.status === 'pending') && (
            <p className="muted">Requesting a summary…</p>
          )}
          {insights.status === 'error' && (
            <p className="muted">No summary: {insights.message ?? 'the service did not reply.'}</p>
          )}
          {insights.records.map((r) =>
            r.analysis ? (
              <p key={r.requestId} className="insight-text">
                {r.analysis}
              </p>
            ) : null,
          )}
          <p className="muted small">
            Generated by a language model from your numbers; it can be wrong. General information only, not
            advice.
          </p>
        </section>
      )}

      {record.notes.length > 0 && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <p className="eyebrow">Notes</p>
          <ul className="consent-list">
            {record.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="row">
        {live ? (
          <>
            <button
              type="button"
              className="btn primary big"
              onClick={() => void controller.saveSession()}
              disabled={app.sessionSaved?.ok === true}
              data-testid="save-session"
            >
              {app.sessionSaved?.ok ? 'Session saved' : 'Save session'}
            </button>
            {app.canRecord && (
              <button type="button" className="btn big" onClick={() => void controller.saveRecording()}>
                {app.recordingSaved?.ok ? 'Recording saved' : 'Save signal recording'}
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn ghost" onClick={() => void controller.leaveSession()}>
              New session
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={() => void controller.openSessions()}>
              Back to saved sessions
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (window.confirm('Delete this saved session? This removes the file.'))
                  void controller.deleteSaved(record.id);
              }}
            >
              Delete this session
            </button>
          </>
        )}
      </div>
      {app.sessionSaved && live && (
        <p className="muted small">
          {app.sessionSaved.ok
            ? `Saved as JSON to ${app.sessionSaved.path}`
            : `Not saved: ${app.sessionSaved.error}`}
        </p>
      )}
      {app.recordingSaved?.ok && live && (
        <p className="muted small">Recording saved to {app.recordingSaved.path}</p>
      )}

      <p className="disclaimer">
        Composure is a rehearsal tool, not a medical device. It does not diagnose, treat, or monitor any
        condition, and its numbers are not for medical decisions. Signals come from the SmartSpectra SDK and
        are estimates relative to your own baseline from this session.
      </p>
    </main>
  );
}

export function SessionsScreen() {
  const controller = useController();
  const app = useStore(controller.app);
  return (
    <main className="screen" data-screen="sessions">
      <p className="eyebrow">Saved sessions</p>
      <h1 className="headline">Saved sessions</h1>
      <p className="lede" style={{ fontSize: 18 }}>
        Only sessions you chose to save are here, as JSON files of numbers on this Mac. Deleting removes the
        file.
      </p>
      <section className="panel">
        {app.savedList.length === 0 && <p className="muted">No saved sessions.</p>}
        {app.savedList.map((s) => (
          <div key={s.id} className="session-row">
            <div style={{ flex: 1 }}>
              <div>{s.createdAt ? new Date(s.createdAt).toLocaleString() : s.id}</div>
              <div className="muted small">
                {s.questionCount} questions · {s.mode} · {s.fileName}
              </div>
            </div>
            <button type="button" className="btn" onClick={() => void controller.viewSaved(s.id)}>
              Open
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (window.confirm('Delete this saved session? This removes the file.'))
                  void controller.deleteSaved(s.id);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </section>
      <div className="row" style={{ marginTop: 18 }}>
        <button type="button" className="btn ghost" onClick={() => controller.backToStart()}>
          Back
        </button>
        <span className="spacer" />
        <button type="button" className="btn link" onClick={() => controller.revealSessionsFolder()}>
          Show folder
        </button>
      </div>
    </main>
  );
}
