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
