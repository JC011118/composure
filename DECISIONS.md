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

## D-025 Metric packets → samples (PresageSignalSource)

`breathing.upperTrace[]` entries become samples (densest series). Slow
readings (`breathing.rate`, `cardio.pulseRate`, `cardio.hrv`) are attached to
each sample only while ≤ 2.5 s old, and only when the latest validationStatus
is OK — never carried across a gap. `face.talking`/`face.blinking` entries are
time-aligned to each trace sample. Sample time = SDK epoch-µs timestamp / 1000
minus the source's start time (`Date.now()`), so `source.now()` and sample
times share one clock. The decoding logic lives in `presageNormalize.ts` (no SDK
import, unit-tested); `PresageSignalSource.ts` stays the only renderer file
importing `@smartspectra/*`. Identical consecutive validation statuses are
debounced (SDK guidance).

## D-026 SDK errors

Auth, configuration, credit, and camera errors end the session; network,
server, and processing errors also end it if they arrive before the first
metrics packet (the SDK never got going). Ending releases the camera and
returns to the start screen with a plain-language explanation and the SDK
error code. Later non-fatal errors show as a banner while the session
continues (gaps appear in the data).

## D-027 Vite pre-bundles the SDK renderer entry points

Real mode loads `PresageSignalSource` with a dynamic import (so other modes
never load SDK code). In dev, Vite discovered the SDK's CommonJS renderer
modules only at that moment and force-reloaded the page mid-start, silently
dropping back to the consent screen. `optimizeDeps.include` lists
`@smartspectra/node-sdk/renderer` and `/messages` so they are pre-bundled.

## D-028 Real-mode check in this build environment

With Chromium's fake camera (`--use-fake-device-for-media-stream`), real mode
was exercised end to end in the Linux build container: the main-process SDK
loaded, the camera opened, frames flowed over the SDK's MessagePort, and the
SDK reported `kNetworkError` because this environment's network policy blocks
`cont-api.physiology.presagetech.com` (the SDK's authentication host). So the
wiring is verified; actual metrics need the morning run on a Mac with normal
internet. `node scripts/smoke-sim.mjs --real` repeats this check.

## D-029 Listening decisions use sample time (SDK latency)

Real SDK metric packets describe moments ~0.5-1 s in the past, while the app
ticks the engine on the wall clock. Measuring silence against the clock made
end-of-answer (and cue A) fire up to a second early — possibly while the packet
showing the user had resumed talking was still in flight. Listening now
evaluates on the latest sample time while samples flow, falling back to the
clock only after 1.5 s without samples (so a stalled SDK can still end an
answer). Covered by a latency test in `tests/engine/engine.test.ts`.

## D-030 Cue A's trace rate counts only breaths inside the silence

The trace-derived rate over a silent span uses only half-cycle estimates whose
whole period lies inside the span. Including the first breath after speech
(whose period started during speech breathing, often 5-6 s) dragged the rate
down and suppressed the cue. As a result cue A typically confirms ~1-3 s after
the 6 s silence threshold, once two full breaths have been measured.

## D-031 Recordings carry session timing for exact replay

With `--record`, the recording stores the question IDs, the engine config, and
every action that changes the engine's course (begin, speech completions,
Done / Skip / Continue / End) with the number of samples received before it.
`runReplay` feeds samples one by one and applies each action at the same point,
so a real session replays to the same debrief — and can be re-run with
different constants (`scripts/replay-check.ts --config=…`) to tune the Gate
without sitting through ten more Gates. Statuses are interleaved by time
(they affect only the HUD/snapshot, not decisions).

## D-032 Gate diagnostics

Each Gate result records how many milliseconds each criterion (gap, no-cycle,
period, amplitude, held, excursion, no-data) kept it closed. Saved sessions
carry it; `scripts/session-report.mjs` and `scripts/replay-check.ts` print it
and map the dominant reason to the constant to loosen (MORNING_CHECKLIST.md).

## D-033 Fixes from the independent review (round 1)

An automated multi-lens review (engine, spec compliance, runtime, security —
each finding then checked by an adversarial verifier) found these, all fixed
with regression tests where testable:

- "Skip to answering"/Enter during the question used to start Listening and
  then immediately close the answer. It now only skips the question audio
  (and cancels the speech).
- The Gate's stall check compared the wall clock with sample time using a
  fixed 1 s, so SDK latency > 1 s or ~1 s packet batching reset the streak on
  every tick and every real Gate would have timed out. The engine now tells
  the Gate about clock time only after `gate.stallMs` (2.5 s, configurable)
  without samples, and late samples never count time twice in diagnostics.
- Cue B now gets a grace period like cue A: silence counts toward ending the
  answer only from cue time + estimated cue speech + `cueB.graceMs` (3 s).
- A short sound that ended just before Listening began no longer counts as
  the answer having started (it used to cancel the no-answer rule and record
  a zero-length answer). Pulse deltas need ≥ 2 s of answer.
- A slow LLM Insights reply from a finished session can no longer stop the
  next session's camera (session generation guard).
- `file://` trust is now the exact bundled `index.html` (or the dev server
  origin in dev); the API-key and session IPC handlers check the sender frame;
  file drops cannot navigate the window.
- The PNG card's "held for N s" / "N s limit" text comes from the config;
  the unused `hrv.confidenceMin` config field was removed (session HRV uses
  the SDK's own `stable` flag).

## D-034 Fixes from the independent review (security lens)

- Packaged builds always point `SMARTSPECTRA_CAPI_PATH` at the bundled
  runtime and ignore an inherited value; otherwise any local process could
  launch the app with its own dylib running under Composure's camera
  permission (the Electron fuses already block the Node-level equivalents).
  The override still works in unpackaged dev runs.
- The consent checkbox resets whenever the statement changes (switching
  camera-free off), so the camera never starts on a box ticked for the
  camera-free wording.
- The permission *check* handler now uses `details.requestingUrl` and requires
  `mediaType === 'video'`, matching the request handler (it previously
  compared an origin with the exact page URL and ignored the media type).
- Verified on a packaged Linux build with Chromium's fake camera
  (`node scripts/smoke-sim.mjs --real --packaged`): the exact `file://` page
  gets the key and the camera; frames reach the bundled runtime.

## D-035 Fixes from the independent review (runtime lens)

- `PresageSignalSource.stop()` keeps its in-flight teardown and every caller
  waits for it; the controller also waits for the previous source's teardown
  before starting a new session. The SDK's preload bridge holds one port per
  window, so a new SDK built while the old one was still draining could be
  killed by the old one's `destroy()`.
- Leaving a session clears any queued HUD update, so the HUD never shows a
  stale mode badge or values after returning to the start screen.
- Camera-free: manual talking is reset on every phase change other than
  Listening (and when the interview screen unmounts), so a Space key held
  through the end of an answer cannot leak into the next question.
- A fatal SDK error after the debrief exists no longer discards it; the
  source is stopped and the error is shown as a banner.

## D-036 Simulator realism additions

Beyond the brief's ranges (breath period 3-6 s, pulse 55-100 bpm with
confidence dips while talking), the simulator now includes occasional sighs
(about 1 in 25 resting breaths is 1.8× deeper and 1.3× slower, as in real
seated breathing; they exercise the Gate's deep-breath check) and respiratory
sinus arrhythmia (pulse ±2 bpm with the breath cycle). Across seeds 1-6 the
demo scenario produces: Gate 1 settles in 11-22 s, the hard question gets
"Take your time." and settles in 8-18 s, the low-signal answer shows "not
enough clean signal" for pulse, the slow settle times out at 45 s, and the
long answer gets the 2:30 cut-in.
