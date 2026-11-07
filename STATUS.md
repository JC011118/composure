# STATUS.md

Build status, updated at each milestone. The final pass rewrites this file
with exactly what was verified, what was not, and the first commands to run.

## Milestone 1 — scaffold

- Electron Forge 8 + Vite 8 + React 19 + TypeScript 6 scaffold.
- Engine skeleton (`config.ts`, `types.ts`, `lexicon.ts`, `stats.ts`).
- Tests green (vitest), lint + typecheck green.
- `npm run dev -- --sim` boots under Xvfb (verified with
  `node scripts/smoke-sim.mjs`).
- `@smartspectra/node-sdk@3.4.0` installed; the linux-x64 native runtime loads
  in plain Node in the build container.

## Milestone 2 — signal sources

- `SignalSource` interface (`src/signals/SignalSource.ts`).
- `SimulatedSignalSource`: seeded synthetic person (30 Hz trace, ~1 Hz lagging
  breathing rate, pulse 55-100 bpm with confidence dips while talking, talking
  flicker, blinking, HRV after ~60 s, random dropouts, camera-tuning warm-up)
  that reacts to interview events per `--sim-scenario`.
- `ReplaySignalSource`, `recordToJson` tap + `parseRecording`,
  `ManualSignalSource` (camera-free mode).
- Tests: determinism, breath period 3-6 s across 8 seeds, pulse range and
  talking dips, dropouts never carry numbers, record → replay round trip.

## Milestones 3-6 — engine, Gate, UI, real SDK wiring

- Engine state machine, baselines, cues, Gate, debrief metrics, session JSON;
  280 tests green, including a replay fixture that reproduces its debrief
  exactly.
- `node scripts/smoke-sim.mjs --full --speed=8` drives consent → debrief in
  Electron under Xvfb with no console errors (screens: signal check, seated
  and talking baselines, interview, Gate, debrief).
- Real mode with Chromium's fake camera: SDK loads in main, camera opens,
  frames reach the SDK; the SDK then reports `kNetworkError` because this
  container cannot reach `cont-api.physiology.presagetech.com`. The app
  returns to the start screen with a plain-language error.
- `npx electron-forge package` (Linux x64) succeeds; the packaged app contains
  the SDK JS closure in app.asar (koffi unpacked) and the native runtime as an
  extra resource, and boots in real mode pointing `SMARTSPECTRA_CAPI_PATH` at it.

## Milestone 7 — debrief, sessions, insights

- Debrief per question (timing, pauses, recovery, pulse/breathing deltas or
  "not enough clean signal", gap-preserving charts), session HRV once,
  LLM Insights section (opt-in, real mode only).
- Smoke-verified in Electron: Save session → listed in Saved sessions →
  opened → deleted (`node scripts/smoke-sim.mjs --full`), and a camera-free
  session driven with the Space key reaches a debrief with paced pauses and no
  physiological numbers (`node scripts/smoke-sim.mjs --camera-free`).
- LLM Insights request/decode path is unit-tested (prompt contents, Insight
  protobuf decoding) but was not exercised against Presage's service (blocked
  network here).

## Milestone 8 — headless SDK check (`node scripts/headless-check.mjs`)

Run in the Linux x64 build container (glibc 2.39) with `PRESAGE_API_KEY` set,
2026-11-07, SDK 3.4.0, synthetic frames via `useCustomInput()`/`sendFrame()`:

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

- Verified: the native runtime (`@smartspectra/node-sdk-linux-x64`) loads via
  koffi; the SDK constructs, accepts custom-input frames, and emits
  processingStatus and error events.
- Not verified: the `metrics` event. The SDK fetches model metadata and
  validates usage against Presage's servers at start (its log shows
  `POST /device/pair` and "Usage verification failed"), and this container's
  network policy blocks those hosts (`cont-api.physiology.presagetech.com`).
- No sample footage: the SmartSpectra GitHub repo ships no test video (its
  headless-testing guide says to supply your own 30-60 s clip). Run
  `node scripts/headless-check.mjs --video=<clip.mp4>` with a clip of your own
  face to see pulse and breathing decode.
- Side observation: the SDK logs that it tries to load an
  `expressions-inference` model even though Composure does not request the
  EXPRESSIONS metric; Composure never reads or shows expression output.
