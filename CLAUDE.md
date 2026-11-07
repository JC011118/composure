# CLAUDE.md — Composure conventions

Composure is a macOS Electron app (TypeScript, Electron Forge + Vite + React)
for interview rehearsal that trains recovery. It uses the SmartSpectra SDK's
live camera signals on-device. Read this file before changing anything.

## Commands

| What | Command |
| --- | --- |
| Install | `npm install` (pulls the SmartSpectra native runtime for every platform, a few hundred MB) |
| Run (auto mode) | `npm run dev` |
| Run simulator | `npm run dev -- --sim` (`--sim-speed=4`, `--sim-seed=7`, `--sim-scenario=demo\|full\|steady\|timeout\|cueB`) |
| Replay a recording | `npm run dev -- --replay=path/to/recording.json` |
| Record signals for replay | `npm run dev -- --record` (offers "Save signal recording" in the debrief) |
| Tests | `npm test` (vitest) |
| Lint + typecheck | `npm run lint` |
| Format | `npm run format` |
| Simulator smoke (Electron + CDP) | `node scripts/smoke-sim.mjs [--full --speed=8]` (`--camera-free`, `--real` with Chromium's fake camera) |
| Real SDK headless check | `node scripts/headless-check.mjs [--video=clip.mp4]` (needs `PRESAGE_API_KEY`) |
| Replay a recording / re-tune | `npx vite-node scripts/replay-check.ts rec.json [--config=x.json] [--write-fixture=name]` |
| Summarize saved sessions | `node scripts/session-report.mjs [--last=N] [paths]` |
| Regenerate the simulator fixture | `npm run fixtures:generate` (after an intentional engine change) |

Every commit must be green: `npm test`, `npm run lint`, and the app must boot
with `npm run dev -- --sim`.

## Sim / real mode switch

Decided once, in `src/main/cli.ts`:

1. `--replay=<file>` → replay mode (recorded normalized samples).
2. `--sim` → simulator.
3. No `PRESAGE_API_KEY` (or `SMARTSPECTRA_API_KEY`) in the environment → simulator.
4. Otherwise → real mode (SmartSpectra SDK, camera).

The renderer asks the main process for `BootInfo` and builds the matching
`SignalSource` in `src/renderer/runtime/`. Simulator mode never loads the
native runtime. The HUD (a monospace strip along the bottom of every screen)
always labels the mode (SDK LIVE / SIMULATED / REPLAY / CAMERA OFF) so a
simulated value is never presented as a measurement.

## Time

Sample `tMs` and `source.now()` share one clock per source. Real SDK packets
arrive late (they describe the past), so listening decisions run on sample
time while samples flow, and the Gate only hears about clock time after
`gate.stallMs` without samples (DECISIONS.md D-029, D-033). Keep it that way:
never compare a wall-clock tick with sample time inside a detector.

## Hard rules

### 1. Banned words

No feelings labels and no diagnosis-adjacent words in UI strings, logs, docs,
comments, test names, or commit messages. The contest list plus extra
feelings labels live **encoded** in `src/engine/lexicon.ts` (decode with
`decodeTerm`; never write the decoded words into any file).
`tests/bannedWords.test.ts` scans `src/`, `docs/`, `tests/`, `scripts/`,
`fixtures/`, `build/`, and every root-level text file, and fails on any hit.
Text we do not author (LLM Insights replies, SDK hint strings) goes through
`redactBannedTerms` before display.

Only show numbers relative to the user's own baseline. Never interpret them.
Never claim diagnosis, treatment, or medical decision-making. Use neutral words:
"signal", "breathing rate", "pulse", "band", "settled", "recovered",
"baseline", "pause".

### 2. The engine is pure

`src/engine/` is plain TypeScript with zero Electron/DOM/Node imports and no
bare-module imports at all. It never reads the clock: time comes from sample
`tMs` values and explicit `tick(tMs)` calls. Enforced by
`tsconfig.engine.json` (no DOM lib, no types) and `tests/architecture.test.ts`.
Everything with logic (state machine, metrics, Gate detector, baselines, cues,
serialization) belongs here, with vitest coverage.

### 3. SDK calls only in PresageSignalSource

`src/signals/PresageSignalSource.ts` is the only renderer file that touches
`@smartspectra/*` APIs. The only other permitted imports are the Electron
wiring the SDK requires: `src/main/sdkBridge.ts` (`bindSmartSpectraIpc`) and
`src/preload/preload.ts` (the preload bridge). Enforced by
`tests/architecture.test.ts`. Never invent an SDK signature — read
`node_modules/@smartspectra/node-sdk/js/**/*.d.ts` and `docs/SDK_NOTES.md`.

### 4. Nothing is stored by default

No frames, video, or audio are ever written. Session JSON is written only when
the user clicks "Save session" (to `<userData>/sessions/`). Signal recordings
(numbers only) are written only with `--record` and an explicit save click.
Never log the API key.

## Signal constraints (design around these)

- rPPG pulse needs stillness and even lighting. Talking, head motion, and poor
  light drop `cardio.pulseRate[].confidence`; the SDK marks a pulse reading
  `stable` at confidence ≥ 40. Pulse deltas are shown only with ≥ 60 % clean
  coverage of the answer.
- `breathing.rate` updates about once per second and lags: it is computed over
  a ~30 s window (confidence starts at 0 and is meaningful after the window
  fills; `stable` at confidence ≥ 45). Use it to confirm, never to trigger.
- `breathing.upperTrace` is the fast signal. The Gate and the breath-cycle
  detector work on the trace (period + amplitude), not on the rate.
- Talking changes chest motion. Breathing deltas are computed over silent spans
  only.
- HRV needs a long stable window (~60 s, `stable` at confidence ≥ 50). Show it
  once per session with its `stable` flag; never per question.
- `face.talking[].detected` flickers frame to frame. Speech is debounced
  (`listening.talkOnDebounceMs` / `talkOffDebounceMs`) before use.
- Validation hints (`validationStatus`) say why capture is degraded. Any
  non-OK status makes `sdkConfidenceOk` false; those spans render as gaps,
  never as numbers.

## Layout

```
src/engine/      pure logic + config.ts (all tunable constants)
src/signals/     SignalSource interface, Presage/Simulated/Replay/Manual sources, recording tap
src/main/        Electron main process (mode selection, IPC, sessions store, SDK bind)
src/preload/     contextBridge (window.composure) + SDK preload bridge
src/renderer/    React UI (screens, HUD, Gate visual, charts, TTS)
src/content/     questions.json, reading passage
src/shared/      IPC contract types
tests/           vitest suites (engine, signals, architecture, banned words, replay e2e)
fixtures/        replay recordings used by tests
scripts/         smoke + headless SDK check + fixture generator
docs/            SDK_NOTES.md (SDK ground truth gathered for this build)
```

## Conventions

- TypeScript strict everywhere. Format with `npm run format` (oxfmt, single
  quotes, width 110). Lint with oxlint.
- Tunable numbers go in `src/engine/config.ts`, never inline. Overrides can be
  passed at runtime with `--config=<json>`.
- Record every non-obvious decision in `DECISIONS.md`. Keep `STATUS.md` honest
  about what was verified and what was not.
