import { useEffect, useState } from 'react';
import { useController, useStore } from '../runtime/hooks';

const TELEMETRY_URL = 'https://smartspectra.presagetech.com/docs/telemetry-and-privacy';
const INSIGHTS_URL = 'https://smartspectra.presagetech.com/docs/llm-insights';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void window.composure?.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

export function ConsentScreen() {
  const controller = useController();
  const app = useStore(controller.app);
  const [agreed, setAgreed] = useState(false);
  const boot = app.boot;
  const opts = app.options;
  const realCamera = boot?.mode === 'real' && !opts.cameraFree;
  // The statement being agreed to changes with the camera setting: ask again.
  useEffect(() => setAgreed(false), [realCamera]);

  return (
    <main className="screen" data-screen="consent">
      <p className="eyebrow">Interview rehearsal · trains recovery</p>
      <h1 className="display">Composure</h1>
      <p className="lede">
        A local interviewer asks you questions out loud. After each answer, the next question waits until your
        breathing settles back into your own seated band. Afterwards you get a debrief made only of numbers
        relative to your own baseline.
      </p>

      {boot?.mode === 'simulated' && (
        <div className="banner info">
          Simulator mode ({boot.modeReason}). No camera is used; every signal on screen is synthetic so you
          can try the whole flow.
        </div>
      )}
      {boot?.mode === 'replay' && (
        <div className="banner info">
          Replay mode: signals come from {boot.replayFile}. No camera is used.
        </div>
      )}
      {boot?.warnings.map((w) => (
        <div key={w} className="banner warn">
          {w}
        </div>
      ))}
      {app.startError && <div className="banner warn">Could not start: {app.startError}</div>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <h2 className="eyebrow">What happens with the camera</h2>
          <ul className="consent-list">
            <li>
              The camera turns on only after you press Begin, and off when the session ends. macOS shows its
              camera indicator the whole time.
            </li>
            <li>
              Frames are processed in memory on this Mac by the SmartSpectra SDK into numbers: a chest
              breathing trace and breathing rate, pulse rate with a confidence score, HRV, and whether you are
              talking or blinking.
            </li>
            <li>
              Nothing is recorded or stored: no video, no images, no audio. Composure has no microphone
              access.
            </li>
            <li>
              Nothing is saved unless you click <strong>Save session</strong> at the end; that writes a small
              JSON file of numbers to this Mac, which you can delete from Saved sessions.
            </li>
            <li>
              The SDK contacts Presage to validate the API key. It also sends an aggregate diagnostics summary
              per session (no video, no measurements) unless you turn that off below.{' '}
              <ExternalLink href={TELEMETRY_URL}>What SDK telemetry includes</ExternalLink>
            </li>
            <li>
              Composure is a rehearsal tool, not a medical device. It does not diagnose, treat, or interpret
              anything; it only compares numbers with your own baseline.
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2 className="eyebrow">Session options</h2>
          <div className="toggle">
            <div style={{ flex: 1 }}>
              <div className="label">Questions</div>
              <div className="desc">Mixed behavioral and technical. Pick 10 for the Gate drill.</div>
            </div>
            <div className="segmented" role="group" aria-label="Question count">
              {[2, 3, 4, 5, 6, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={opts.questionCount === n ? 'on' : ''}
                  onClick={() => controller.setOptions({ questionCount: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={opts.cameraFree}
              onChange={(e) => controller.setOptions({ cameraFree: e.target.checked })}
              data-testid="consent-camerafree"
            />
            <div>
              <div className="label">Camera-free mode</div>
              <div className="desc">
                No camera and no SDK. Hold or tap Space while you speak; the Gate becomes a 15 s paced pause
                and the debrief shows timing only.
              </div>
            </div>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={opts.insightsOptIn}
              disabled={opts.cameraFree}
              onChange={(e) => controller.setOptions({ insightsOptIn: e.target.checked })}
              data-testid="consent-insights"
            />
            <div>
              <div className="label">LLM Insights (cloud, off by default)</div>
              <div className="desc">
                At the end, ask Presage's LLM Insights service for a short written summary. This sends your
                per-question numbers and the SDK's buffered pulse, HRV, and breathing-rate values (never
                video) to Presage, which forwards them to a language model. Replies can be wrong and are not
                advice. Per the SDK documentation, the SDK may also send periodic automatic vitals summaries
                during any measurement; Composure never displays those.{' '}
                <ExternalLink href={INSIGHTS_URL}>About LLM Insights</ExternalLink>
              </div>
            </div>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={opts.telemetry}
              disabled={opts.cameraFree}
              onChange={(e) => controller.setOptions({ telemetry: e.target.checked })}
            />
            <div>
              <div className="label">Share SDK diagnostics with Presage</div>
              <div className="desc">
                Aggregate session summary only: SDK version, platform, frame-rate and quality counters. No
                video, no measured values, no identifiers.
              </div>
            </div>
          </label>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            data-testid="consent-optin"
          />
          <div>
            <div className="label">
              {realCamera
                ? 'I agree to turn on the camera for this rehearsal, processed on this Mac as described above.'
                : 'I understand how this rehearsal works and what is (and is not) captured.'}
            </div>
            <div className="desc">You can end the session at any time; the camera stops immediately.</div>
          </div>
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn primary big"
            disabled={!agreed || app.starting || !boot}
            onClick={() => void controller.startSession()}
            data-testid="consent-begin"
          >
            {app.starting ? 'Starting…' : 'Begin rehearsal'}
          </button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => void controller.openSessions()}>
            Saved sessions
          </button>
        </div>
      </section>
    </main>
  );
}
