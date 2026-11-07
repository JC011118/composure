# STATUS.md

State of Composure at the end of the overnight build (2026-11-07). Read this
first; then MORNING_CHECKLIST.md.

## TL;DR

- **Works end to end in simulator mode.** `npm run dev -- --sim` boots, and
  an automated Electron run (`node scripts/smoke-sim.mjs --full`) goes
  consent → signal check → seated and talking baselines → interview → Gate →
  debrief → save → saved sessions → open → delete with no console errors.
  Camera-free mode is verified the same way.
- **Real-mode wiring is verified up to Presage's servers.** With Chromium's
  fake camera, the dev app and a packaged Linux build open the camera and
  stream frames into the SmartSpectra SDK. The SDK then stops with
  `kNetworkError`, because this build container cannot reach
  `cont-api.physiology.presagetech.com` (authentication and model download).
- **No real SmartSpectra metrics have been observed yet.** Every threshold
  in `src/engine/config.ts` is tuned on the simulator only. The first job in
  the morning is MORNING_CHECKLIST.md on a real Mac with a webcam.

## Verified (in the Linux build container)

| What | How | Result |
| --- | --- | --- |
| Unit and integration tests | `npm test` | 20 files, 300+ tests, all passing |
| Lint + typecheck (incl. no-DOM engine typecheck) | `npm run lint` | clean |
| Banned words absent from every source/doc file | `tests/bannedWords.test.ts` | passing |
| Engine purity; SDK imported only in PresageSignalSource (+ main/preload wiring) | `tests/architecture.test.ts` | passing |
| State machine incl. 10 s arming, cue A/B, Gate unlock vs timeout, skip, end early, camera-free | `tests/engine/engine.test.ts` | passing |
| Gate: clean trace unlocks in ~5 s; noisy 2× amplitude never unlocks before 45 s; settles under SDK latency and 1 s batching | `tests/engine/gate.test.ts`, engine tests | passing |
| Metrics on synthetic traces with known answers | `tests/engine/*.test.ts` | passing |
| Full simulated session through the engine → debrief JSON | `tests/replay.test.ts` | passing |
| Recorded session replays to the identical debrief | `tests/replay.test.ts` (fixture `sim-demo-seed7`) | passing |
| Simulator realism: breath period 3–6 s (8 seeds), pulse 55–100 bpm with confidence dips while talking | `tests/signals/simulator.test.ts` | passing |
| Electron app in simulator mode, every screen, save/list/open/delete | `node scripts/smoke-sim.mjs --full --speed=8` (Xvfb) | OK, no console errors |
| Camera-free session driven by the Space key | `node scripts/smoke-sim.mjs --camera-free` | OK |
| Real mode, dev build, Chromium fake camera | `node scripts/smoke-sim.mjs --real` | camera opens, frames reach the SDK, SDK reports `kNetworkError` (code 5); the app releases the camera and returns to the start screen with a plain-language message |
| Packaging (Linux x64) | `npx electron-forge package` | OK: SDK JS closure in app.asar (koffi unpacked), native runtime as extra resource |
| Real mode, packaged build | `node scripts/smoke-sim.mjs --real --packaged` | same as dev: exact own-page checks pass, camera and key reach the SDK, `kNetworkError` |
| SDK in headless Node with custom input | `node scripts/headless-check.mjs` | native runtime loads; 313/313 synthetic frames accepted; `kIdle → kStarting → kError` with `kNetworkError`; no metrics (network) |

Headless check output (2026-11-07, SDK 3.4.0, linux-x64, glibc 2.39):

```json
{
  "processingStatus": ["kIdle", "kStarting", "kError"],
  "framesSent": 313,
  "framesAccepted": 313,
  "metricsEvents": 0,
  "errors": ["kNetworkError (5): A network error occurred during SmartSpectra processing. [retryable]"],
  "verdict": "SDK loaded and started, then reported an error (see errors)"
}
```

The SDK's own log during that run showed `POST /device/pair failed … CONNECT
tunnel failed, response 403` while fetching model metadata, then "Usage
verification failed". It also tried to load an `expressions-inference` model
even though Composure does not request the EXPRESSIONS metric; Composure never
reads or shows expression output. No sample footage exists in the SmartSpectra
repo, so `--video=` was not run.

## Not verified (needs real hardware or network)

- **Any real metric**: breathing trace shape and scale, breathing rate, pulse
  and confidence, HRV, talking/blinking detection. The `metrics` event has
  never fired for this app.
- **Gate behavior on real breathing**: whether 1.5 SD bands, 400 ms / 15 %
  floors, the 5 s hold, and the held-breath/deep-breath checks open for a
  settled person and stay closed for an unsettled one. Simulator Gates settle
  in ~8–20 s; real breathing is more variable.
- **Talking detection timing** with real `face.talking` flicker and SDK packet
  latency (the code judges listening on sample time, and tests cover 800 ms
  latency and 1 s batching, but the real SDK has not been exercised).
- **Pulse coverage while talking** (the 60 % rule): how often a pulse delta can
  be shown at all.
- **macOS specifics**: camera prompt text (NSCameraUsageDescription), the
  darwin-arm64 native runtime, `npm run make` on a Mac, code signing.
- **TTS**: `window.speechSynthesis` voices on macOS. The Linux container had no
  voices, so the engine's fallback timers drove every question.
- **LLM Insights**: the request flow and Insight protobuf decoding are
  unit-tested with hand-encoded buffers but have never reached Presage's service.
- **SDK telemetry opt-out** (`enableTelemetry: false`) is passed through; its
  effect can't be observed from here.
- The docs site (`smartspectra.presagetech.com`) and dev.to were unreachable.
  SDK facts come from the npm package typings and the GitHub repo's markdown
  (DECISIONS.md D-001). DEV_POST.md follows the section list in the brief.

## Independent review

An automated review workflow (four lenses: engine, spec compliance, renderer
runtime, Electron security/privacy; each finding re-checked by an adversarial
verifier) found 14 distinct defects. All are fixed, with regression tests where
testable (DECISIONS.md D-033 to D-035). The most important: with real SDK
packet latency the Gate would have timed out on every question, and "Skip to
answering" closed the answer it was meant to start.

## First commands in the morning

```bash
git pull && npm install && npm test
```

```bash
export PRESAGE_API_KEY=your-key-here
```

```bash
node scripts/headless-check.mjs --seconds=20
```

```bash
npm run dev -- --record --devtools
```

Then follow MORNING_CHECKLIST.md: ten consecutive Gates
(`node scripts/session-report.mjs --last=1`), pulse coverage over five
answers, and a replay fixture
(`npx vite-node scripts/replay-check.ts <rec.json> --write-fixture=real-1`).

## Known gaps and risks

- If real breathing traces are noisy or small, the breath-cycle detector
  (`cycles.*`) and the Gate floors will need tuning; `scripts/replay-check.ts
  --config=…` tests changes on a recorded session without re-recording.
- The SDK auto-sends vitals snapshots for its own LLM Insights during any
  measurement (per Presage's docs; no switch in 3.4.0). This is disclosed on
  the consent screen and in CONSENT_AND_DATA.md; camera-free mode avoids it.
- `npm install` pulls ~350 MB of native runtimes for every platform (SDK
  design).
- Packaging is native-only: build the Mac app on an Apple Silicon Mac.
- The README screenshots are from the simulator (labelled as such).
