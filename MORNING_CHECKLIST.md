# Morning checklist — real-webcam spike

Everything below was built and tested against the simulator. The build
container could not reach Presage's servers, so **no real SmartSpectra metrics
have been seen yet** (see STATUS.md). This is the protocol for the first
real-hardware session: about 45 minutes on an Apple Silicon Mac.

Keep a copy of the log tables below (or paste them into STATUS.md) as you go.

## 0. Sanity (5 min)

```bash
git pull
```

```bash
npm install
```

```bash
npm test
```

```bash
npm run dev -- --sim
```

Click through consent → Begin and watch the simulated baseline for a few
seconds; the HUD should say `SIMULATED`. Quit.

```bash
export PRESAGE_API_KEY=your-key-here
```

```bash
node scripts/headless-check.mjs --seconds=20
```

Expected: `processingStatus` reaches `kRunning`, then validation codes such as
`kNoFaceFound` (the synthetic frames contain no face). A `kAuthenticationFailed`
or `kNetworkError` means the key or the network is the problem, not the app.
If you have a 30–60 s clip of your face, also run:

```bash
node scripts/headless-check.mjs --video=/path/to/clip.mp4
```

Expected verdict: `metrics event fired and decoded`, with `breathing.rate` and
`cardio.pulseRate` in `latest`.

## 1. First real boot (5 min)

```bash
npm run dev -- --record --devtools
```

- [ ] macOS camera prompt appears on **Begin**, not before. Allow it.
- [ ] HUD badge `SDK LIVE`; `validationStatus` turns `kOk` within ~10 s of
      sitting centered in even light. Note any hint that keeps appearing.
- [ ] `breathing.rate` appears with confidence rising over ~30 s;
      `cardio.pulseRate` within ~15 s.
- [ ] The live trace on the baseline screens shows clear breaths (one rise
      and fall every 3–6 s). If it's flat or noisy, fix framing (upper chest
      visible) and stillness first; nothing below will work without it.
- [ ] `face.talking.detected` flips to `true` while you read the passage.

| Check | Result |
| --- | --- |
| Seconds from Begin to first `kOk` | |
| Seconds from Begin to first `breathing.rate` | |
| Seated band on the debrief ("Gate band" period range, "Depth band" amplitude range) | |
| Talking detected while reading? (yes / flickery / no) | |

## 2. Ten consecutive Gates — unlock vs timeout (20 min)

On the consent screen choose **10 questions**. Answer each briefly (15–30 s,
natural pauses), then sit still and breathe normally through the Gate. Don't
help the Gate along: the point is to see how it behaves for you.

After the 10th Gate, on the debrief click **Save session** *and* **Save signal
recording** (save it as `~/Desktop/real-1.recording.json` now; it exists only
in memory and is lost when the app quits). Then:

```bash
node scripts/session-report.mjs --last=1
```

The report prints one line per Gate (outcome, recovery time, fraction of time
in band, and which criterion held the Gate closed and for how long) and
applies the rule below automatically.

| Gate | Outcome (settled / timed out) | Recovery (s) | Held closed mostly by |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |

### If more than 1 in 3 Gates time out (≥ 4 of 10)

Loosen **one constant at a time**, in this order, keyed to the reason the
report lists first. Try each on the recording you just saved (step 4) or live
with a JSON override, before editing `src/engine/config.ts`:

```bash
npm run dev -- --record --config=tuning.json
```

| Report says the Gate was held closed by | Loosen | From → to |
| --- | --- | --- |
| `amplitude` (breath depth outside band) | `gate.minAmplitudeHalfWidthFrac` | 0.15 → 0.25 |
| | then `gate.bandSdMultiplier` | 1.5 → 2.0 |
| `period` (breath timing outside band) | `gate.minPeriodHalfWidthMs` | 400 → 700 |
| | then `gate.bandSdMultiplier` | 1.5 → 2.0 |
| `excursion` (single deep breaths) | `gate.excursionTolerance` | 1.15 → 1.5 |
| `held` (pauses between breaths) | `gate.turningPointSlack` | 0.75 → 1.25 |
| `no-cycle` (breaths not being detected) | `cycles.hysteresisFrac` | 0.3 → 0.2 |
| `gap` / `no-data` | not a constant | fix light, framing, stillness |
| still > 1 in 3 after the above | `gate.holdMs` (deviates from the brief's 5 s; note it in DECISIONS.md) | 5000 → 4000 |

Example `tuning.json`:

```json
{ "gate": { "minAmplitudeHalfWidthFrac": 0.25 } }
```

Better than re-running ten Gates by hand: replay the recording you just made
with different constants (step 4) to see how many of the same ten Gates would
have opened.

**If fewer than 1 in 10 time out and recoveries are under ~3 s**, the band may
be too loose to mean anything: tighten `gate.bandSdMultiplier` toward 1.5 or
lower the floors.

## 3. Pulse confidence coverage during 5 spoken answers (5 min)

Use questions 1–5 from step 2 (or run a 5-question session). Coverage is the
fraction of each answer with SDK pulse confidence ≥ 40 and a usable signal.
The debrief shows it under "Pulse vs talking baseline" ("clean N %"), and
`session-report.mjs` prints it per answer.

| Answer | Clean pulse coverage | Delta shown? |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |

- If coverage is ≥ 60 % but no delta is shown, the debrief says "no clean
  pulse in the talking baseline" (and `session-report.mjs` prints a note):
  the read-aloud baseline itself had no pulse at confidence ≥ 40. Re-run with
  better light and keep your head still while reading.
- ≥ 3 of 5 answers at ≥ 60 %: fine, keep the rule.
- Mostly below 60 %: expected for camera pulse while talking. Improve light
  first (even, frontal, no flicker) and keep your head still while you speak.
  **Do not** lower `debrief.pulseConfidenceMin` below 40 (the SDK's own
  `stable` threshold), and keep the 60 % rule; "not enough clean signal" is
  the honest output. Note the result in STATUS.md.

## 4. Capture a replay JSON for the test suite (5 min)

Use the recording saved at the end of step 2 (`~/Desktop/real-1.recording.json`;
any session started with `--record` offers **Save signal recording** on its
debrief). It holds only the normalized numbers, the question IDs, the
constants used, and the session's timing (clock ticks, speech endings, manual
actions), so a replay reproduces the same debrief.

Check that it replays to the same Gate outcomes:

```bash
npx vite-node scripts/replay-check.ts ~/Desktop/real-1.recording.json
```

Try tuning on that same session without sitting through it again:

```bash
npx vite-node scripts/replay-check.ts ~/Desktop/real-1.recording.json --config=tuning.json
```

Add it to the test suite (copies it into `fixtures/replays/` and writes the
expected debrief next to it; `tests/replay.test.ts` replays every fixture):

```bash
npx vite-node scripts/replay-check.ts ~/Desktop/real-1.recording.json --write-fixture=real-1
```

```bash
npm test
```

Commit the fixture. (It contains your breathing and pulse numbers but no
images; keep it out of a public repo if you'd rather not publish them.)

## 5. Before filming

- [ ] Bake any constants you changed into `src/engine/config.ts` and run
      `npm test`. Behavior tests pin their own copy of the constants
      (`tests/engine/testConfig.ts`), so they stay green; replay fixtures
      carry the constants they were recorded with. The one test that will
      flag a change is `tests/engine/config.test.ts`, which checks the brief's
      spec values (1.5 SD band, 5 s hold, 45 s timeout, 4 s / 10 s listening,
      6 s cue A, 2:30 cue B). If you deliberately deviate, update that test
      and record why in DECISIONS.md. Commit.
- [ ] Do one full dry run of DEMO_SCRIPT.md.
- [ ] Replace the simulator screenshots in `docs/screenshots/` with real ones.
- [ ] Update STATUS.md with the tables above.
