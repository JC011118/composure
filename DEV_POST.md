*This is a submission for the [Presage SmartSpectra Challenge](https://dev.to/challenges/presage-2026-11-04).*

## What I Built

**Composure** is an interview rehearsal room that trains *recovery*, not just
answers.

Most interview practice tools grade what you said. But the moment that
decides a real interview is often the one right after a hard question: the
long silence, the racing start to the next answer. Composure practices that
moment.

A local text-to-speech interviewer asks you questions. The SmartSpectra SDK
watches your breathing, pulse, and whether you're talking, using nothing but
your Mac's camera, and Composure uses those signals four ways:

1. **Hands-free interviewing.** Your answer starts when you start talking and
   ends after a natural pause. No buttons, no "press when done".
2. **Gentle live cues.** If you go quiet mid-answer for more than six seconds
   *and* your breathing during that silence is above your own seated band, the
   interviewer says "Take your time." If you've been talking for two and a
   half minutes, it asks: "Let me stop you there — can you summarize in one
   sentence?"
3. **The Composure Gate.** After each answer, the next question waits until
   your live breathing trace settles back into *your own* seated band (breath
   period and depth within 1.5 SD of your baseline) and stays there for five
   seconds. The screen is a still body of water whose ripples die down as you
   settle. When it opens you get a "Recovered in 12.4 s" card you can save as a
   PNG. If you don't settle within 45 s, the Gate opens anyway and the debrief
   says so honestly: "recovery: timed out".
4. **An honest debrief.** Per question: time to first word, talk time, pauses
   of 1.5 s or more, recovery time, pulse change against your *talking*
   baseline (shown only when at least 60 % of the answer had a clean pulse
   signal, otherwise "not enough clean signal"), and breathing-rate change
   measured only during silences (talking distorts breathing). Session HRV is
   shown once, with the SDK's `stable` flag. Any span where the SDK said the
   signal was not usable is drawn as a gap, never as a number.

Everything is relative to *your* baseline from *this* session. There are no
population norms, no scores, and no labels for how you feel. It is a
rehearsal tool, not a medical device.

## Demo

🎥 **Video:** `[VIDEO LINK]`

The 90-second demo opens on the Gate settling: the water stilling as the
breathing trace slides back into the band, the HUD strip along the bottom showing the
live SDK fields. Then one hard question, a long silence, the interviewer's
"Take your time.", the answer, the Gate unlocking ("Recovered in N s"), and the
debrief. The full shot list is in
[DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## Code

📦 **Repository:** `[REPO LINK]`

Electron + React + TypeScript, built with Electron Forge and Vite.

- `src/engine/` is pure TypeScript with zero Electron or DOM imports (enforced
  by a separate no-DOM typecheck and an architecture test). It holds the
  interview state machine, a breath-cycle detector on the chest trace, the
  Gate detector, baseline statistics, cue logic, debrief metrics, and the
  session JSON format. Every tunable constant lives in one `config.ts`.
- `src/signals/` defines a `SignalSource` interface with four
  implementations: `PresageSignalSource` (the only renderer file that calls
  the SDK), a seeded `SimulatedSignalSource` that reacts to the interview, a
  `ReplaySignalSource`, and a camera-free manual source. A `recordToJson` tap
  captures real sessions for replay.
- 280+ vitest tests, including a full simulated session through the engine,
  a recorded fixture that must replay to the identical debrief, Gate tests
  (a clean trace unlocks in about 5 s; a noisy trace at twice the amplitude
  never unlocks before the 45 s timeout), and a test that scans every source
  and doc file for banned words.

```bash
npm install
```

```bash
PRESAGE_API_KEY=your-key npm run dev
```

```bash
npm run dev -- --sim
```

## How It Responds to Human Signals

Composure requests exactly seven SmartSpectra metrics (`CHEST_BREATHING`,
`ABDOMEN_BREATHING`, `BREATHING_RATE`, `PULSE_RATE`, `HRV`, `TALKING`,
`BLINKING`) through `@smartspectra/node-sdk/renderer`, decodes each `metrics`
packet with `@smartspectra/node-sdk/messages`, and normalizes it into one
sample stream. A HUD on every screen shows the raw fields as they arrive:
`face.talking.detected`, `breathing.rate`, `cardio.pulseRate` with its
confidence, and a signal-quality chip driven by `validationStatus`.

The design rule is **fast signals trigger, slow signals only confirm**:

| Signal | SDK field | What Composure does with it |
| --- | --- | --- |
| Talking (per frame, debounced) | `face.talking[].detected` | Starts the answer on the first word; ends it after 4 s of silence once the answer has run 10 s; times pauses; triggers the 2:30 cut-in. |
| Breathing trace (fast) | `breathing.upperTrace[]` | A turning-point detector measures each breath's period and depth. The seated baseline's mean ± 1.5 SD defines the Gate band. The Gate unlocks after 5 s in band and also catches a held or very deep breath before the cycle completes. |
| Breathing rate (slow, ~30 s window) | `breathing.rate[]` + confidence | Confirms cue A when no breath cycle completed inside the silence; feeds the "breathing in silences vs seated baseline" delta. |
| Pulse (slow, needs stillness) | `cardio.pulseRate[]` + confidence | Talking and seated baselines; a per-answer delta only when ≥ 60 % of the answer had confidence ≥ 40 (the SDK's own `stable` threshold). |
| HRV (needs a long window) | `cardio.hrv[]` (`rmssd`, `stable`) | Shown once per session with its `stable` flag, never per question. |
| Capture quality | `validationStatus` code + hint | Any non-OK status marks the span unusable: gaps in every chart, excluded from every number, and the SDK's hint shown in the HUD. |

Signal limits shaped the product. rPPG pulse drops out while people talk, so
pulse is compared against a *talking* baseline and hidden when coverage is
thin. The breathing rate lags, so it never triggers anything on its own.
Talking moves the chest, so breathing deltas use silent spans only.

## Prize Categories

Entering **Best Thoughtful Real-World Use**.

- **A real problem with a humane framing.** Interview performance often turns
  on the seconds after a hard question. Composure turns those seconds into a
  practicable skill (getting back to your own baseline) and measures
  improvement against yourself, not against a norm.
- **Signals used within their limits.** Each metric is used only where it is
  trustworthy, with confidence gating, coverage rules, a talking baseline for
  pulse, silent-span-only breathing deltas, and gaps instead of guesses.
- **Language that does no harm.** No feelings labels anywhere, enforced by a
  test. No scores, no diagnosis. False-positive cues are deliberately harmless
  ("Take your time.").
- **Consent that means something.** Explicit opt-in, camera only after Begin,
  a camera-free mode, nothing stored by default, cloud insights off by
  default.

## Consent and Data Handling

- **Explicit opt-in.** Nothing starts on launch. A consent screen explains
  what the camera produces, what is never stored, the SDK's network calls and
  telemetry (with a link to Presage's telemetry page and an opt-out toggle),
  and the LLM Insights option (off by default). Begin is disabled until you
  agree.
- **Camera only, on-device, in memory.** Frames go from the camera to the
  SDK's native library in memory and are discarded. Composure grants only
  video-only camera access to its own page; it has no microphone access.
- **Nothing stored by default.** "Save session" writes a JSON file of
  numbers to your Mac's app-data folder; the in-app Saved sessions list opens
  and deletes them. No frames, images, video, or audio, ever.
- **Cloud is opt-in.** LLM Insights (off by default) sends baseline-relative
  numbers and the SDK's buffered metric values (never imagery) for a written
  summary, shown with a reminder that it can be wrong. Any feelings label in
  the reply is redacted. The SDK's automatic vitals snapshots, which its
  documentation says it sends on its own during a measurement, are never
  displayed. Camera-free mode avoids the SDK entirely.
- **Not a medical device.** No diagnosis, treatment, or medical
  decision-making.

Full details: [CONSENT_AND_DATA.md](CONSENT_AND_DATA.md).

## Agent Session

Composure was built in one unattended overnight session with **Claude Code**
(Anthropic's coding agent), working from a written brief and making its own
calls while the human author slept:
[agent session](https://claude.ai/code/session_01B9reVzjSikEYLjUDHW7Pp1).

How the session went:

- **SDK ground truth first.** The brief required reading the SDK's
  documentation before writing SDK code. The docs site was unreachable from
  the build sandbox, so the agent read the TypeScript declarations bundled in
  `@smartspectra/node-sdk@3.4.0`, the public SmartSpectra GitHub repository's
  markdown docs, and the official Electron quickstart. It corrected several
  details of the brief along the way (the renderer must decode with
  `/messages`; the `insight` payload is a protobuf the SDK doesn't decode;
  some breathing metric codes make `start()` throw in 3.5).
- **Engine before UI.** The pure state machine and Gate detector came first,
  with tests written against synthetic traces with known answers, then a
  realistic simulator, then the UI.
- **Verification it could run itself.** The agent drove the real Electron
  app over the Chrome DevTools Protocol under a virtual display, from consent
  to debrief, through save and delete, taking screenshots and fixing what it
  saw (the first full run exposed a rule interaction that made "Take your
  time." nearly impossible to trigger). It also exercised real mode with a
  synthetic camera and a headless SDK script. These confirmed the wiring end
  to end, up to the point where the sandbox's network blocked Presage's
  authentication server.
- **A paper trail.** Every non-obvious decision is in `DECISIONS.md`, and
  `STATUS.md` separates what was verified from what still needs a real
  webcam. `MORNING_CHECKLIST.md` is the human's protocol for the
  real-hardware tuning pass.
