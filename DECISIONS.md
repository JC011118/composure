# DECISIONS.md

Non-obvious decisions made while building Composure unattended. Each entry:
what was decided, why, and what to revisit. Newest entries at the bottom.

## D-001 SDK ground truth came from npm + GitHub, not the docs site

`smartspectra.presagetech.com` (skill.md, llms.txt, every `/docs/*.md` page)
was blocked by this build environment's network policy (proxy answered 403 to
CONNECT). Per the brief, the source of truth became the TypeScript
declarations bundled in `@smartspectra/node-sdk@3.4.0`. The public GitHub repo
`Presage-Security/SmartSpectra` was reachable, and it contains the same docs
as markdown (`nodejs/docs/*.md`, `docs/telemetry-and-privacy.md`,
`docs/measurement-quality.md`, `docs/data-types.md`, `docs/llm-insights/*.md`,
`.agents/skills/using-smartspectra/SKILL.md`) plus the official
`electron-quickstart` sample. Everything SDK-related was checked against those
and summarized in `docs/SDK_NOTES.md`. **Revisit:** skim the live docs pages
once in the morning for anything newer than the repo snapshot (main branch,
commit dated 2026-09-30).

## D-002 Pin `@smartspectra/node-sdk` to exactly 3.4.0

3.4.0 is the latest stable (`latest` dist-tag). 3.5.0-rc.5 exists and changes
behavior (see D-004) and the telemetry option's wording. Pinned exactly so the
docs in this repo match the runtime. **Revisit:** upgrade deliberately after
the contest.

## D-003 Corrections to the brief's SDK anchors

All anchors were verified against the `.d.ts`; differences found:

- In the renderer, `decodeMetrics` must come from
  `@smartspectra/node-sdk/messages` (renderer-safe). The package root pulls in
  koffi/FFI and cannot be bundled into a browser context. (Root `decodeMetrics`
  does work in the main process in 3.4.0 because it registers the bundled
  class eagerly.)
- The renderer SDK's `breathingMetrics`, `cardioMetrics`, `MetricType`, etc.
  are re-exported from `@smartspectra/node-sdk/renderer`, so the renderer never
  imports the package root.
- The renderer `metrics` callback receives a `Uint8Array` (not a `Buffer`);
  protobuf `timestamp` fields are int64 microseconds since the Unix epoch and
  may decode as `Long` objects, so they are converted explicitly.
- `breathing.rate[]` also carries `confidence` (0-100) and `stable`, not just
  `value`.
- The `insight` event delivers a serialized `presage.smartspectra.Insight`
  protobuf that the SDK does **not** ship a decoder for. Composure decodes it
  with a minimal hand-written reader of the documented schema
  (`request_id=1, processed_at=2, analysis=3, error=4, type=5`).
- `requestInsight` is `Promise<number>` in the renderer, `number` in main.
- `validationStatus` hints and codes match the brief; code 0 is OK.
- The renderer SDK takes the API key in its constructor options, so the key
  must reach the renderer. See D-008.

## D-004 Request hand-picked metric codes instead of whole bundles

Requested: `CHEST_BREATHING`, `ABDOMEN_BREATHING`, `BREATHING_RATE`,
`PULSE_RATE`, `HRV`, `TALKING`, `BLINKING`. Not requested:
`BREATHING_AMPLITUDE`, `APNEA`, `RESPIRATORY_LINE_LENGTH`, `BASELINE`,
`INHALE_EXHALE_RATIO` (3.5.0-rc documents that requesting these makes
`start()` throw `kConfigurationFailed`), `FACE_LANDMARKS`, and `EXPRESSIONS`
(a facial-expression classifier would be a feelings label; Composure must not
produce one). `ARTERIAL_PRESSURE_TRACE` is also not requested (unused).
LLM Insights need breathing + cardio, which this set covers.

## D-005 Banned terms are stored encoded

The banned-words test must scan every source and doc file, and CLAUDE.md must
describe the rule, but writing the words anywhere would fail the scan. The
lists live in `src/engine/lexicon.ts` shifted by one character code and are
decoded at runtime for the test and for redaction. The list was extended
beyond the five contest terms with common feelings labels (whole-word match).
Neutral design words are used instead (for example "quiet" instead of the
usual word for a low-arousal look).

## D-006 Mode selection

`PRESAGE_API_KEY` (preferred) or `SMARTSPECTRA_API_KEY` (the SDK docs'
convention) selects real mode; `--sim` forces the simulator; `--replay=<file>`
wins over both. `npm run dev` is `electron-forge start --`, so
`npm run dev -- --sim` reaches the app as `--sim`.

## D-007 Camera permission in dev mode

The brief says grant `media` only to `file://` pages. In dev, Forge serves the
renderer from the Vite dev server (`http://localhost:<port>`), so a strict
`file://` check would deny the camera during `npm run dev` — the exact command
used for the morning hardware spike. The handler grants `media` only when: the
app is in real mode, the request is video-only (no microphone), and the
requesting URL is `file://` **or** (dev builds only) the exact Vite dev-server
origin. Packaged builds only ever load `file://`. Everything else is denied.

## D-008 API key path

The renderer SDK's `configure` message carries `apiKey` to the main process,
so the key has to exist in the renderer for the SDK call. Main reads it from
the environment and returns it over a dedicated IPC handler only in real mode;
it is never logged, never put in BootInfo, never persisted, and only
`PresageSignalSource` reads it. **Revisit for distribution:** a packaged app
should read it from the macOS Keychain rather than the environment.

## D-009 Native runtime packaging

Forge's Vite plugin bundles only `.vite/` output, and the SDK resolves its
native runtime package with `require.resolve` at runtime, so
`@smartspectra/node-sdk` is externalized in `vite.main.config.mts`, its pure-JS
dependency closure is copied into the app in a `packageAfterCopy` hook, and the
platform package (`node-sdk-darwin-arm64` on macOS) ships as an
`extraResource`. When packaged, `src/main/sdkBridge.ts` sets
`SMARTSPECTRA_CAPI_PATH` to that resource before requiring the SDK (the same
pattern as the official electron-quickstart). Forge evaluates its config on the
build host, so packaging is native-only and cross-builds are refused with a
clear error.

## D-010 CSP

One policy, injected into `index.html` by a small Vite plugin. Production:
`script-src 'self'`, `worker-src 'self' blob:` (SDK requirement),
`media-src 'self' blob: mediastream:`, `connect-src 'self'`, no objects, no
base URI. Dev adds `'unsafe-inline'` scripts and `ws://localhost:*` for Vite's
HMR and the React refresh preamble.

## D-011 Signal check before the seated baseline

The SDK needs a few seconds of camera tuning and its confidence values start
at 0. A `signalCheck` phase (not in the brief's state list) runs before
BaselineSeated and waits for 5 s of cumulative `sdkConfidenceOk` signal (max
60 s, then proceeds with a debrief note). Without it the 30 s seated baseline
would often be half warm-up on real hardware.

## D-012 Baselines extend when the signal was poor

If less than 60 % of a baseline phase had a usable signal, the phase extends
in 10 s steps (max +30 s). Baseline breathing rate prefers readings at or
above the SDK's stable confidence (45) and falls back to all clean readings
(with a note) when the SDK's ~30 s window has not filled.

## D-013 Gate "inside the band" definition

The brief defines the band as seated mean ± 1.5 SD of breath period and
amplitude. A breath takes 3-6 s, so a 5 s hold spans only one or two breaths;
waiting for whole cycles alone would react slowly. A sample counts as inside
when: the signal is usable; the latest half-cycle estimate (period +
peak-to-trough amplitude) is inside the band; the current half-cycle has not
run longer than the band allows (catches a held breath); and the trace has not
swung beyond half the upper amplitude bound from its resting line (catches a
deep breath). Floors stop a very regular seated baseline from producing an
impossibly narrow band: period half-width ≥ 400 ms, amplitude half-width ≥
15 % of the seated mean (raised from 300 ms / 10 % after simulator runs showed
a settled breather flickering in and out of a 10 % band for 30+ s; a 30 s
baseline yields only ~12-15 half-cycles, so its mean alone is uncertain by
about a quarter of an SD). With fewer than 6 seated half-cycles the Gate uses a
wide fallback band (2.5-8 s, median amplitude ± 50 %) and says so. All of this
lives in `config.ts` (`gate.*`, `cycles.*`, `baseline.*`).

## D-014 Recovery time = when the final in-band streak began

`recoveryTimeMs` is measured from Gate start to the start of the 5 s streak
that unlocked the Gate (0 when the trace was already inside the band). The
unlock itself happens 5 s later. The card reads "Recovered in N s". A
timed-out Gate records `recoveryTimeMs = null` and "recovery: timed out".

## D-015 The Gate is seeded with recent trace history

At Gate start the detector is fed the last 12 s of trace (`gate.lookbackMs`)
so the current breath cycle is already known; otherwise even a perfectly
settled user would wait an extra breath or two. The streak still only counts
from Gate start.

## D-016 Talking is debounced

`face.talking.detected` flickers frame to frame. Speech counts as started after
150 ms of raw `true` and stopped after 350 ms of raw `false`; edges are
back-dated to the raw transition, so "answer starts at the first talking=true"
still holds to within a frame. Set both to 0 to get the literal behavior.

## D-017 Listening rules not fully specified by the brief

- Silence before the first word does not count toward cue A ("mid-answer").
- End-detection silence is counted from max(last speech end, the moment
  end-detection arms at answer start + 10 s). With the literal reading
  (silence accumulated before arming counts), any silence that began early in
  the answer closed the answer the instant it armed, leaving cue A a window of
  about 1.5 s — found in the first full simulator run, where a hesitant answer
  was closed after its 2 s opener.
- When cue A fires, end-of-answer silence is counted from (cue time + 6 s),
  so "Take your time." is never followed by the answer being closed (the
  user gets ~10 s to resume).
- Cue B condition: the answer has run 2:30 and the user is talking right now
  (debounced). A long answer always contains short gaps, so "continuously"
  is read as "no end-of-answer silence yet".
- Cue A confirmation prefers the rate implied by the trace's own breath
  cycles inside the silent span (≥ 2 half-cycles): it is literally "measured
  over the silent span". The SDK's `breathing.rate` is computed over a ~30 s
  window, so 6-10 s into a silence it mostly reflects the time before it; it is
  the fallback when no cycles completed (needs ≥ 2 s of readings). The seated
  rate band is mean + max(1.5 SD, 1 br/min); if the seated SDK rate is missing
  it is derived from the seated breath period.
- No speech at all for 60 s closes the question ("no answer detected"); a
  single answer is capped at 4 min. A "Done" button / Enter key ends the
  answer manually, and the Gate has a "Skip" button (recorded as "skipped",
  never as a recovery time). Both exist so a talking-detection miss on real
  hardware never traps the user.
- Answer timing: answer span = first word → last word; Listening ends when
  end-detection fires.

## D-018 Debrief metric definitions

- Pulse delta = time-weighted mean of clean pulse (SDK confidence ≥ 40,
  usable signal) over the answer span minus the TALKING baseline mean;
  shown only if those readings cover ≥ 60 % of the answer, otherwise
  "not enough clean signal".
- Breathing delta = time-weighted mean SDK breathing rate over silent spans
  (≥ 1.5 s) inside the Listening window (think time, pauses, and the closing
  silence) minus the SEATED baseline mean; needs ≥ 5 s of covered silence.
- Session HRV: the latest reading the SDK marked stable, else the latest
  reading; shown once with its `stable` flag and confidence.
- Chart series are bucketed means (10 Hz trace, 1 Hz pulse/rate); a bucket
  with no usable sample is `null` and drawn as a gap.

## D-019 Camera-free mode

Camera-free mode starts no camera and no SDK. Talking comes from the keyboard
(hold or toggle Space) via `ManualSignalSource`; samples carry
`sdkConfidenceOk=false`, so no physiological number can appear. The signal
check and baselines are skipped and the Gate becomes a fixed 15 s paced pause
(`cameraFree.pauseMs`). Timing metrics (time to first word, talk time,
pauses) still work.

## D-020 Replay fixture

`fixtures/replays/sim-demo-seed7.recording.json` (~2.5 MB) is a simulator
recording of a 3-question session; the expected debrief is computed by
replaying it, so the test is an exact regression check of the engine on fixed
input. Timestamps are stored at 0.001 ms precision so the replay is
frame-exact. Regenerate with `npm run fixtures:generate` after an intentional
engine change.

## D-021 UI architecture

The renderer never re-renders React per sample: live canvases (trace, water)
read the engine's live buffer on each animation frame; React re-renders from
the engine snapshot, which is throttled to 10 Hz of engine time plus every
event. The HUD store is coalesced to 10 Hz. Speech goes through
`window.speechSynthesis` (local voices); when it never reports an end (no
voices, e.g. headless Linux) the engine's per-utterance fallback timer moves
on. Enter = "Done answering"; Space = talking in camera-free mode.

## D-022 SDK telemetry toggle defaults ON, LLM Insights default OFF

The SDK's telemetry is aggregate-only, opt-out by design, and Presage asks
integrators to disclose it; the consent screen discloses it, links the
telemetry page, and offers the opt-out (passed as `enableTelemetry`). LLM
Insights is a cloud call that sends derived values and our prompt, so it is
opt-in and off by default. When on, one on-demand summary is requested at the
debrief and the camera stays on until it arrives (max 25 s). Replies are passed
through `redactBannedTerms`. Auto-fired vitals insights (which the SDK sends
on its own per its docs) are never displayed.

## D-023 HUD shows the mode at all times

The HUD lists the raw SDK field names (`face.talking.detected`,
`breathing.rate`, `cardio.pulseRate` + confidence, `validationStatus`) with
current values. In simulator/replay/camera-free modes the badge says so
("SIMULATED · synthetic signals, not a measurement"), so a demo video can
never pass simulated numbers off as SDK output.

## D-024 Recovered card PNG

Rendered on an offscreen 1200×630 canvas (share-card size) from the saved
series: headline, question text, the Gate-period breathing trace, talk time and
pauses, and the pulse delta only when it was shown in the debrief. No camera
imagery. Saved through a native save dialog.
