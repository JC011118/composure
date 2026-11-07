# Demo script — 90 seconds

Goal: show the Composure Gate doing its job on real SmartSpectra signals, with
the HUD visible the whole time as proof of live SDK use. The video **opens on a
Gate settling**, includes **one hard question that gets "Take your time."**,
shows the **"Recovered in N s" card**, and ends on the **debrief**.

Film in real mode (`SDK LIVE` badge in the HUD). Never use simulator footage
as if it were real; the HUD would say `SIMULATED` anyway.

## Before you roll (5 minutes, once)

- [ ] Even, front light on your face; nothing bright behind you. Plain,
      lighter top (dark clothes hide chest movement).
- [ ] Laptop on a table, not your lap: the breathing trace needs a still
      camera. Face and upper chest in frame, centered.
- [ ] macOS Do Not Disturb on. Close other camera apps.
- [ ] System volume ~60 % so the interviewer's voice is clearly recorded.
- [ ] Screen recorder that captures system audio (OBS, or macOS screen
      recording with "Record system audio"). Record the full Composure window
      at 1440×900 or larger.
- [ ] `export PRESAGE_API_KEY=…` then `npm run dev`.
- [ ] Consent screen: **3 questions**, LLM Insights off, diagnostics as you
      like. The question order puts a warm-up first and a **hard question
      second**.

## Off camera (≈ 90 s, not filmed)

1. Tick the consent box → **Begin rehearsal**.
2. Signal check, then the 30 s seated baseline: sit back, breathe normally,
   stay quiet.
3. Talking baseline: read the passage aloud.
4. Question 1 (warm-up): answer for ~20 s, then stop talking.
5. **Start recording the moment you stop answering Question 1.** The Gate
   appears.

## Shot list

| Time | Shot | What happens on screen | You do / say |
| --- | --- | --- | --- |
| 0:00–0:14 | **Cold open: the Gate settling** (full window, HUD bottom-right) | Ripples on the water, the trace outside the band; status reads e.g. "Breaths are deeper than your seated band". The trace slides into the shaded band, the hold bar fills, the water goes glassy, and the **"Recovered in N s"** card fades in. | Sit still and breathe normally. Silent. |
| 0:14–0:20 | **Push-in on the HUD** (zoom in the edit) | `face.talking.detected false`, `breathing.rate 14.1 /min · conf 82`, `cardio.pulseRate 71 bpm · conf 88`, `validationStatus ● kOk`, badge `SDK LIVE`. | — |
| 0:20–0:26 | Card → **Next question** | Click **Next question** (or let the 6 s countdown run). | Caption: *"The next question waits until your breathing is back in your own band."* |
| 0:26–0:34 | **The hard question** | Interviewer reads Question 2 aloud (e.g. "Tell me about a time you failed to deliver something you committed to…"). | Listen. |
| 0:34–0:46 | **Freeze → cue** | Listening indicator: "Listening…", then "Paused 3 s… 6 s…". At ~6–8 s of silence the interviewer says **"Take your time."** and the transcript line updates. | Start: "That's… a good question." Then **stop talking for 8–10 s**, looking at the screen, breathing a little quicker than at rest (it happens naturally after a hard question; don't force it). |
| 0:46–0:58 | Answer | "Listening…" with the talk strip under the trace; the interviewer stays quiet. | Answer for ~10 s, then **stop and stay quiet**. After 4 s of silence the answer closes by itself. |
| 0:58–1:10 | **Gate #2** | Ripples, band, reason text, hold bar; unlock → **"Recovered in N s"**. Click **Save card as PNG** and show the save dialog briefly. | Breathe normally. |
| 1:10–1:26 | **Debrief** (click "See debrief" after Question 3, or End session) | Headline "N of N Gates settled · median recovery …". Scroll Q2's card: chip **cue "Take your time."**, time to first word, pauses, recovery, pulse vs talking baseline (or "not enough clean signal"), breathing in silences, the trace with talk shading and **gaps**. Pause on **Session HRV** with `stable: true/false`. | Caption: *"Every number is relative to your own baseline. Gaps mean the signal wasn't clean enough, so no number."* |
| 1:26–1:30 | Close | Hold on the debrief disclaimer or a title card. | Caption: *"On-device. Nothing stored unless you save. Not a medical device."* |

Question 3 can be cut in the edit (answer it briefly off camera, or use **End
session** after Gate #2; the debrief keeps the completed questions).

## Retake guide

- **"Take your time." didn't fire.** It needs ≥ 6 s of silence after you've
  started answering *and* breathing during that silence above your seated
  band. Stay silent longer (8–10 s), and make sure you said a few words first
  (silence before the first word doesn't count). It fires once per question.
- **The answer closed too early.** End-detection only arms 10 s after your
  first word, then needs 4 s of silence. If you paused longer than 4 s after
  the 10 s mark, it closed. Keep pauses shorter once you're into the answer.
- **The Gate won't open.** Sit still and breathe at your normal pace. If the
  HUD's chip turns orange, check framing and light (the hint says what's
  wrong). It opens anyway at 45 s ("recovery: timed out"), which is also a
  fine, honest shot.
- **Fast reset.** **End session** → **New session** → Begin. You're back at
  the Q1 Gate in about 90 s (signal check + two baselines + Q1).
- **Talking not detected.** Face the camera and keep your mouth visible. As a
  last resort, **Done answering** (Enter) closes an answer manually. Avoid it
  on camera; the point is that it's hands-free.

## B-roll (optional, clearly labelled)

`npm run dev -- --sim --sim-scenario=demo --sim-speed=2` reproduces every
screen with synthetic signals. The HUD shows `SIMULATED · synthetic signals,
not a measurement`. Use it only for a labelled "how it works" insert, never in
place of the real-signal shots.
