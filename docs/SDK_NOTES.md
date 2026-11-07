# SmartSpectra SDK notes (ground truth for this build)

Gathered on 2026-11-07 from `@smartspectra/node-sdk@3.4.0` (bundled `.d.ts`
and JS) and the public `Presage-Security/SmartSpectra` GitHub repo (docs as
markdown + `nodejs/samples/electron-quickstart`). The docs site itself was not
reachable from the build environment (see DECISIONS.md D-001).

## Install

- `npm install @smartspectra/node-sdk` (Node ≥ 20; Node 24 LTS recommended;
  Electron ≥ 28). The main package depends on all four native runtime packages
  (`@smartspectra/node-sdk-{darwin-arm64,linux-x64,linux-arm64,win32-x64}`),
  so the install is a few hundred MB. Only the matching one loads.
- Linux runtime needs glibc ≥ 2.35. macOS runtime is Apple Silicon only.
- Override the native library with `SMARTSPECTRA_CAPI_PATH`.

## Entry points

| Import | Use |
| --- | --- |
| `@smartspectra/node-sdk` | `SmartSpectraSDK` (main/Node, koffi FFI), enums, metric bundles, `decodeMetrics` |
| `@smartspectra/node-sdk/main` | `bindSmartSpectraIpc(win, { logger? })` |
| `@smartspectra/node-sdk/preload` | side-effect import; exposes `window.__smartspectraBridge` |
| `@smartspectra/node-sdk/renderer` | renderer `SmartSpectraSDK` (MediaStream input) + re-exported enums/bundles |
| `@smartspectra/node-sdk/messages` | `decodeMetrics(buf)` (renderer-safe), `Metrics`, `presage` namespace |

## Renderer SDK (what Composure uses)

```ts
new SmartSpectraSDK({ apiKey, requestedMetrics, enableTelemetry?, enableAccumulatedOutput?, sendTimeoutMs? })
sdk.useMediaStream(stream)            // optional; default acquires front camera 1280x720@30
await sdk.start(); await sdk.stop(); await sdk.reset(); sdk.destroy();
await sdk.requestInsight(text)        // Promise<number> request id
sdk.on('streamAvailable', (stream: MediaStream) => …)
sdk.on('metrics', (buf: Uint8Array, timestampUs: number) => …)
sdk.on('validationStatus', (code: number, timestampUs: number, hint: string) => …)
sdk.on('processingStatus', (status: number) => …)   // 0 uninit,1 idle,2 starting,3 running,4 stopping,5 error
sdk.on('insight', (buf: Uint8Array, requestId: number) => …)
sdk.on('error', (code: number, message: string, retryable: boolean) => …)
```

`on()` keeps one callback per event (a second call replaces the first).
Control calls reject with `code === 'SMARTSPECTRA_IPC_TIMEOUT'` after
`sendTimeoutMs` (default 30 s) if the main process stalls. A startup watchdog
emits `error` code 8 if processing sits at "starting" for 30 s.

## Metrics payload (decoded with `/messages` `decodeMetrics`)

Each array is a time series of samples; take `.at(-1)` for the latest.
Timestamps are int64 microseconds since the Unix epoch (may be `Long`).

- `breathing.rate[]` `{ value (br/min), confidence 0-100, stable (conf ≥ 45), timestamp }`
- `breathing.upperTrace[]`, `lowerTrace[]` `{ value (unitless), stable, timestamp }`
- `cardio.pulseRate[]` `{ value (bpm), confidence 0-100, stable (conf ≥ 40), timestamp }`
- `cardio.hrv[]` `{ rmssd, sdnn, meanNn, baevsky, confidence, stable (conf ≥ 50), timestamp }`
- `face.talking[]`, `face.blinking[]` `{ detected, stable, timestamp }`

Warm-up: confidence is meaningful after ~12 s (pulse), ~30 s (breathing rate
and traces), ~60 s (HRV).

## Validation codes

0 OK, 1 no face, 2 multiple faces, 3 face not centered, 4 (deprecated) size,
5 too dark, 6 too bright, 7 chest not visible, 10 camera tuning, 11 frame rate
too low, 12 excessive motion, 13 face too close, 14 face too far, 15 face too
high, 16 face too low, 17 face not forward. The `hint` string is designed to be
shown as-is; debounce identical statuses.

## Electron requirements

- `bindSmartSpectraIpc(win)` in main; preload must load the SDK preload bridge;
  `contextIsolation: true`, `sandbox: true` are supported.
- CSP must allow `worker-src 'self' blob:`.
- macOS: `NSCameraUsageDescription` in Info.plist; hardened runtime needs
  `com.apple.security.cs.disable-library-validation` for the bundled dylibs.
- Grant the `media` permission only to your own page, video-only.
- Packaged apps: ship `node_modules/@smartspectra/node-sdk-<plat>-<arch>/` as
  an extra resource and set `SMARTSPECTRA_CAPI_PATH` before requiring the SDK.

## Telemetry (from docs/telemetry-and-privacy.md)

On by default, opt-out with `enableTelemetry: false`. One aggregate summary per
session: SDK build, runtime (platform, OS version, device model, CPU arch,
binding), session shape (source kind, outcome, number of metrics requested),
performance counters, counts of validation states, a coarse error code on
failure, and a timestamp. Never: frames, metric values, file paths, prompts,
free-text errors, user or stable device identifiers. Sent over the SDK's
authenticated, TLS-pinned channel; best-effort.

## LLM Insights (from docs/llm-insights/index.md and nodejs/docs/llm-insights.md)

- While a session runs, the SDK **auto-fires** vitals snapshots (first stable
  pulse, breathing, HRV, then every 60 s) to Presage's analytics gateway with a
  fixed built-in prompt; there is no documented switch to disable this in
  3.4.0. Each sends the buffered metric values (pulse rate, HRV, breathing
  rate), request metadata, and no imagery.
- On-demand: `requestInsight(prompt)` sends the prompt plus the buffered
  metrics (prompt-only if the buffer is empty).
- Replies arrive on `on('insight')` as a serialized `Insight` protobuf:
  `request_id (int32) = 1`, `processed_at (string) = 2`,
  `oneof result { analysis (string) = 3; error (string) = 4 }`,
  `type (enum) = 5`. Correlate by request id.
- LLM output can be wrong; it is general wellness information only.

## Authentication and network

The SDK authenticates the API key and validates the subscription with Presage's
backend; metric computation itself runs on-device. There is no offline mode.
