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
