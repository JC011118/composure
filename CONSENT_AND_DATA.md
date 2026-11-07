# Consent and data handling

Composure is built so that you always know when the camera is on, what it
produces, and what (if anything) leaves your Mac or gets saved.

**Composure is not a medical device.** It does not diagnose, treat, prevent,
or monitor any condition, makes no medical decisions, and must not be used for
any. Its numbers are estimates from the SmartSpectra SDK, shown only relative
to your own baseline from the same session, for rehearsal. Presage's own
documentation states that SDK metrics are for general wellness and
informational purposes only and are not cleared by the FDA.

## 1. Camera consent flow

1. **Nothing starts on launch.** The app opens on a consent screen. No camera,
   no SDK session, no network call to Presage happens until you press
   **Begin rehearsal**.
2. **Explicit opt-in.** Begin stays disabled until you tick a checkbox that
   states what will happen: "I agree to turn on the camera for this rehearsal,
   processed on this Mac as described above." The screen lists what is
   processed, what is never stored, the network calls the SDK makes (with a
   link to Presage's telemetry page), the LLM Insights opt-in (off by
   default), and the camera-free alternative.
3. **OS-level prompt.** The first time, macOS asks whether the app may use the
   camera (`NSCameraUsageDescription`: "Composure uses the camera to measure
   breathing, pulse, and talking on this Mac during a rehearsal. Video is
   processed in memory and never stored."). macOS shows its green camera
   indicator for as long as the camera is on.
4. **Camera only, never the microphone.** The Electron permission handler
   grants the `media` permission only for video-only requests from
   Composure's own page, only in real mode. Microphone, screen capture,
   notifications, and every other permission are denied. Talking is detected
   visually by the SDK; no audio is captured.
5. **Always visible, always stoppable.** While the camera is on, the HUD shows
   `camera on · frames stay in memory` with a red dot. Every screen has a way out ("Stop and
   turn off camera" or "End session"). The camera is released when the
   session reaches the debrief (or when an LLM Insights reply arrives, at most
   25 s later, if you opted in), when you end early, or when the SDK reports
   an error.
6. **Camera-free mode.** A toggle on the consent screen runs the whole
   rehearsal without the camera or the SDK. You hold Space while you speak,
   the Gate becomes a 15 s paced pause, and the debrief shows timing only.

There is no covert mode. The camera never runs in the background, and nothing
measures you outside a session you started.

## 2. What is processed

In real mode, the SmartSpectra SDK's renderer component reads frames from the
camera into memory and passes them over an in-process message channel to the
SDK's native library in Composure's main process. The SDK turns them into
numbers. Composure requests only these metrics:

| SDK output | Used for |
| --- | --- |
| `breathing.upperTrace`, `breathing.lowerTrace` (chest / abdomen movement) | live trace, breath period and depth, the Gate |
| `breathing.rate` (+ confidence) | baselines, cue A fallback, breathing change in silences |
| `cardio.pulseRate` (+ confidence) | baselines, pulse change per answer |
| `cardio.hrv` (RMSSD, `stable` flag) | one session-level HRV figure |
| `face.talking`, `face.blinking` | hands-free answer timing |
| `validationStatus` (code + hint) | signal-quality chip; non-OK spans become gaps |

Composure does **not** request facial landmarks or facial-expression output,
and never derives or displays any label about how you feel. (The SDK's own
log shows it loads an expression model internally during start-up; Composure
neither requests nor reads that output.) Frames are never written to disk,
never sent anywhere by Composure, and are discarded as soon as the SDK has
processed them.

## 3. What is stored

**Nothing, by default.** A rehearsal leaves no file behind unless you choose
to save one.

- **Save session** (debrief screen): writes one JSON file to
  `<userData>/sessions/<id>.json` (on macOS:
  `~/Library/Application Support/Composure/sessions/`). It contains numbers
  only: timings, baseline statistics, per-question deltas, cue events, Gate
  outcomes, downsampled charts of the breathing trace, pulse and breathing
  rate (unusable spans stored as `null`), session HRV, the question text, and
  any LLM Insights reply you opted into. No frames, images, video, or audio.
- **Save card as PNG** (Gate and debrief screens): writes the "Recovered in
  N s" card wherever you choose in a save dialog. The card is drawn from
  numbers, not from the camera.
- **Save signal recording** (only when the app was started with `--record`):
  writes the normalized numeric samples the engine received, for replay and
  testing. No frames.

Composure keeps no logs of measurements. It never logs the API key.

## 4. Retention and deletion

- Saved sessions stay on your Mac until you delete them. **Saved sessions**
  (on the consent screen) lists them; **Delete** removes the file after a
  confirmation. **Show folder** opens the directory if you prefer to manage
  the files yourself.
- PNG cards and signal recordings are ordinary files wherever you saved them;
  delete them like any other file.
- Composure has no account, no server, and no sync; there is nothing to
  delete anywhere else.
- In-memory data (live samples, the current debrief) is dropped when you
  start a new session or quit.

## 5. SDK network use and telemetry

The SmartSpectra SDK computes metrics on-device, but it needs the network:

- **Authentication and models.** At start-up the SDK validates the API key and
  subscription with Presage's service and fetches model metadata. There is no
  offline mode. (Composure reads the key from the `PRESAGE_API_KEY`
  environment variable and hands it to the SDK; it is never stored or logged.)
- **Aggregate telemetry** (summary of
  [SDK Telemetry & Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy),
  as published in the SDK's documentation repository): once per measurement
  session the SDK can send an aggregate diagnostic summary containing the SDK
  build (version, package origin), runtime (platform, OS version, device
  model, CPU architecture, SDK binding), session shape (input source kind,
  outcome, the *number* of metrics requested), performance counters (frame
  throughput, input frame-rate statistics, start-up latency, produced-metric
  counts), quality counters (counts of validation states such as lighting or
  motion warnings, and a coarse error code for a failed session), and a
  timestamp. According to that page it never includes raw frames, measured
  values of any metric, file paths, prompts, free-text error messages, or
  user or stable device identifiers, and is sent only over the SDK's
  authenticated, TLS-pinned channel, best-effort. Telemetry is on by default
  in the SDK; Composure's consent screen has a **Share SDK diagnostics with
  Presage** toggle that passes `enableTelemetry: false` when you turn it off.
  (Note: the 3.5 release candidate's typings describe a broader report that
  "can contain free text, paths and platform context". Composure pins SDK
  3.4.0; re-read the telemetry page before upgrading.)

## 6. LLM Insights — an opt-in cloud call

LLM Insights turn measured values into a short written summary using a large
language model run by Presage. It is **off by default**, and available only in
real mode.

- **If you opt in** (consent screen toggle), at the debrief Composure makes one
  request: it sends a prompt containing your per-question, baseline-relative
  numbers (for example "Q2: pulse +5 bpm vs talking baseline, breathing back
  in seated band after 12 s"). The SDK adds its buffered metric values (pulse
  rate, HRV, breathing rate, as a numeric series) and request metadata, and
  sends them to Presage's analytics gateway, which forwards them to the
  language model. Per Presage's documentation, raw video and facial imagery
  are never transmitted. The prompt tells the model to use only the numbers,
  not to label feelings, and not to give medical advice. The reply is shown on
  the debrief with the note that it can be wrong and is general information
  only. Any word on Composure's banned list is replaced with
  "[label removed]" before display.
- **Automatic insights.** Presage's documentation says the SDK also dispatches
  automatic vitals snapshots of its metric buffer (derived numbers, no
  imagery) during a running measurement, with a fixed prompt, whether or not
  the app asks. SDK 3.4.0 has no documented switch to turn this off.
  Composure never displays these automatic replies, and asks for nothing more
  unless you opt in. If you want no metric values to leave your Mac at all,
  use camera-free mode.
- Saved sessions include an Insights reply only if you opted in and one
  arrived.

## 7. Contest and product rules Composure follows

- No diagnosis or treatment claims, no medical decision-making, no covert
  monitoring.
- No label of any kind about how you feel appears in the UI, logs, or docs.
  A test (`tests/bannedWords.test.ts`) scans every source and documentation
  file against an encoded list of banned terms on every run.
- Only numbers relative to your own baseline are shown, with the baseline
  visible next to each delta. When the signal is not good enough, the debrief
  says "not enough clean signal" instead of showing a number.
