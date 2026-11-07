import { describe, expect, it } from 'vitest';
import { NOT_ENOUGH_SIGNAL, parseSession, serializeSession } from '../../src/engine/session';
import { findBannedTerms } from '../../src/engine/lexicon';
import { ScriptedRun, type Ctx } from './helpers';

const listening = (c: Ctx, from: number, to: number) =>
  c.phase === 'listening' && c.since >= from && c.since < to;

/** Baseline talking + a 22 s answer with one 2 s pause. */
const normalTalk = (_t: number, c: Ctx) =>
  c.phase === 'baselineTalking' || (listening(c, 1_000, 23_000) && !(c.since >= 10_000 && c.since < 12_000));

describe('InterviewEngine state machine', () => {
  it('walks consent → signal check → baselines → each question → debrief', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 2 });
    expect(run.engine.currentPhase).toBe('consent');
    run.runTo(1_000);
    expect(run.engine.currentPhase).toBe('consent'); // nothing happens without consent
    run.engine.begin(1_000);
    run.runTo(400_000);
    expect(run.phases()).toEqual([
      'signalCheck',
      'baselineSeated',
      'baselineTalking',
      'asking',
      'listening',
      'gate',
      'asking',
      'listening',
      'gate',
      'debrief',
    ]);
    const ph = run.events.filter((e) => e.type === 'phase') as { phase: string; tMs: number }[];
    const at = (p: string) => (ph.find((e) => e.phase === p) as { tMs: number }).tMs;
    expect(at('baselineSeated') - at('signalCheck')).toBeGreaterThanOrEqual(5_000);
    expect(at('baselineSeated') - at('signalCheck')).toBeLessThan(5_200);
    expect(at('baselineTalking') - at('baselineSeated')).toBeCloseTo(30_000, -2);
    expect(at('asking') - at('baselineTalking')).toBeCloseTo(30_000, -2);
    // Question speech (2 s scripted TTS) precedes listening.
    expect(at('listening') - at('asking')).toBeCloseTo(2_000, -2);
    expect(run.events.filter((e) => e.type === 'speak').map((e) => (e as { kind: string }).kind)).toEqual([
      'question',
      'question',
      'outro',
    ]);
    expect(run.last('debriefReady')).toBeDefined();
  });

  it('computes baselines and the personal Gate band from the seated phase', () => {
    const run = new ScriptedRun({
      talking: normalTalk,
      pulse: (_t, c) => (c.phase === 'baselineTalking' ? 74 : 66),
    });
    run.engine.begin(0);
    run.runTo(70_000);
    const snap = run.engine.snapshotNow();
    expect(snap.seated?.breath?.periodMeanMs).toBeCloseTo(4_000, -2);
    expect(snap.seated?.breath?.ampMean).toBeCloseTo(2, 1);
    expect(snap.seated?.pulse?.mean).toBeCloseTo(66, 5);
    expect(snap.talking?.pulse?.mean).toBeCloseTo(74, 5);
    expect(snap.seated?.breathingRate?.mean).toBeCloseTo(14, 5);
    expect(snap.band?.personal).toBe(true);
    expect(snap.band?.periodLoMs).toBeLessThan(4_000);
    expect(snap.band?.periodHiMs).toBeGreaterThan(4_000);
  });

  it('extends a baseline phase when too little of it had a clean signal', () => {
    const run = new ScriptedRun({
      talking: normalTalk,
      ok: (_t, c) => !(c.phase === 'baselineSeated' && c.since > 2_000 && c.since < 26_000),
    });
    run.engine.begin(0);
    run.runTo(120_000);
    const ph = run.events.filter((e) => e.type === 'phase') as { phase: string; tMs: number }[];
    const seated = ph.find((e) => e.phase === 'baselineSeated') as { tMs: number };
    const talking = ph.find((e) => e.phase === 'baselineTalking') as { tMs: number };
    expect(talking.tMs - seated.tMs).toBeGreaterThanOrEqual(40_000);
  });

  it('debrief metrics: time to first word, talk time, pauses, recovery, deltas', () => {
    const run = new ScriptedRun(
      {
        talking: normalTalk,
        pulse: (_t, c) => (c.phase === 'baselineTalking' ? 72 : c.phase === 'listening' ? 78 : 66),
        rate: (_t, c) => (c.phase === 'listening' ? 17 : 14),
      },
      { questions: 1 },
    );
    run.engine.begin(0);
    run.runTo(200_000);
    const [r] = run.engine.snapshotNow().results;
    expect(r.timeToFirstWordMs).toBeGreaterThanOrEqual(1_000);
    expect(r.timeToFirstWordMs).toBeLessThan(1_100);
    expect(r.talkTimeMs).toBeGreaterThan(19_800);
    expect(r.talkTimeMs).toBeLessThan(20_200);
    expect(r.pauseCount).toBe(1);
    expect(r.endReason).toBe('silence');
    expect(r.recovery).toBe('settled');
    expect(r.recoveryTimeMs).toBeLessThan(1_000);
    expect(r.gate.endMs - r.gate.startMs).toBeGreaterThanOrEqual(5_000);
    expect(r.gate.endMs - r.gate.startMs).toBeLessThan(6_000);
    expect(r.pulse.shown).toBe(true);
    expect(r.pulse.coverage).toBeGreaterThan(0.95);
    expect(r.pulse.deltaBpm).toBeCloseTo(6, 5);
    expect(r.breathing.shown).toBe(true);
    expect(r.breathing.deltaBrPerMin).toBeCloseTo(3, 5);
    expect(r.cues).toEqual([]);
  });

  it('hides the pulse delta below 60 % clean coverage', () => {
    const run = new ScriptedRun(
      {
        talking: normalTalk,
        pulseConf: (_t, c) => (listening(c, 0, 14_000) ? 25 : 85),
      },
      { questions: 1 },
    );
    run.engine.begin(0);
    run.runTo(200_000);
    const [r] = run.engine.snapshotNow().results;
    expect(r.pulse.shown).toBe(false);
    expect(r.pulse.deltaBpm).toBeNull();
    expect(r.pulse.reason).toBe(NOT_ENOUGH_SIGNAL);
    expect(r.pulse.coverage).toBeLessThan(0.6);
  });

  it('cue A: one "Take your time." on a long silence with breathing above the seated band', () => {
    const talking = (_t: number, c: Ctx) =>
      c.phase === 'baselineTalking' || listening(c, 1_000, 3_000) || listening(c, 14_000, 26_000);
    // Breathing speeds up (4 s → 2.5 s breaths) during the silence.
    let phase = 0;
    let last = 0;
    const trace = (t: number, c: Ctx) => {
      phase += (2 * Math.PI * (t - last)) / (listening(c, 3_000, 14_000) ? 2_500 : 4_000);
      last = t;
      return Math.sin(phase);
    };
    const run = new ScriptedRun(
      { talking, trace, rate: (_t, c) => (listening(c, 3_000, 14_000) ? 19 : 14) },
      { questions: 1 },
    );
    run.engine.begin(0);
    run.runTo(200_000);
    const cues = run.events.filter((e) => e.type === 'cue');
    expect(cues).toHaveLength(1);
    const listenStart = (
      run.events.find((e) => e.type === 'phase' && e.phase === 'listening') as { tMs: number }
    ).tMs;
    const cue = cues[0] as { event: { cue: string; tMs: number; breathingRateOverSpan: number } };
    expect(cue.event.cue).toBe('A');
    expect(cue.event.tMs - listenStart).toBeGreaterThan(9_000);
    expect(cue.event.tMs - listenStart).toBeLessThan(9_200);
    expect(cue.event.breathingRateOverSpan).toBeGreaterThan(15);
    const speak = run.events.filter((e) => e.type === 'speak' && e.kind === 'cueA') as { text: string }[];
    expect(speak.map((s) => s.text)).toEqual(['Take your time.']);
    // The answer was not closed right after the cue; the user resumed and finished.
    const [r] = run.engine.snapshotNow().results;
    expect(r.endReason).toBe('silence');
    expect(r.listenEndMs - listenStart).toBeGreaterThan(29_900);
    expect(r.cues.map((c) => c.cue)).toEqual(['A']);
  });

  it('cue A stays quiet when breathing during the silence is inside the band', () => {
    const talking = (_t: number, c: Ctx) =>
      c.phase === 'baselineTalking' || listening(c, 1_000, 3_000) || listening(c, 14_000, 26_000);
    const run = new ScriptedRun({ talking, rate: () => 14.5 }, { questions: 1 });
    run.engine.begin(0);
    run.runTo(200_000);
    expect(run.events.filter((e) => e.type === 'cue')).toHaveLength(0);
  });

  it('cue B: cuts in after 2:30 of continuous talking, then the answer ends on silence', () => {
    let cueSeen = false;
    const run: ScriptedRun = new ScriptedRun(
      {
        talking: (_t: number, c: Ctx): boolean =>
          c.phase === 'baselineTalking' || (c.phase === 'listening' && c.since >= 1_000 && !cueSeen),
      },
      { questions: 1 },
    );
    run.engine.on((e) => {
      if (e.type === 'cue') cueSeen = true;
    });
    run.engine.begin(0);
    run.runTo(400_000);
    const cues = run.events.filter((e) => e.type === 'cue') as {
      event: { cue: string; answerElapsedMs: number };
    }[];
    expect(cues.map((c) => c.event.cue)).toEqual(['B']);
    expect(cues[0].event.answerElapsedMs).toBeGreaterThanOrEqual(150_000);
    expect(cues[0].event.answerElapsedMs).toBeLessThan(150_100);
    const speak = run.events.find((e) => e.type === 'speak' && e.kind === 'cueB') as { text: string };
    expect(speak.text).toMatch(/summarize in one sentence/);
    const [r] = run.engine.snapshotNow().results;
    expect(r.endReason).toBe('silence');
    expect(r.cues.map((c) => c.cue)).toEqual(['B']);
  });

  it('Gate times out at 45 s when breathing stays at 2× amplitude', () => {
    const run = new ScriptedRun(
      {
        talking: normalTalk,
        trace: (t, c) => (c.phase === 'gate' ? 2 : 1) * Math.sin((2 * Math.PI * t) / 4_000),
      },
      { questions: 1 },
    );
    run.engine.begin(0);
    run.runTo(300_000);
    const unlocked = run.last('gateUnlocked');
    expect(unlocked?.timedOut).toBe(true);
    expect(unlocked?.recoveryTimeMs).toBeNull();
    const [r] = run.engine.snapshotNow().results;
    expect(r.recovery).toBe('timed out');
    expect(r.gate.endMs - r.gate.startMs).toBeGreaterThanOrEqual(45_000);
    expect(r.gate.endMs - r.gate.startMs).toBeLessThan(45_100);
  });

  it('judges end-of-answer on sample time when packets arrive late', () => {
    // Samples reach the engine 800 ms after the moment they describe (SDK latency),
    // while the app ticks on the wall clock. A 3.6 s mid-answer pause must not close the answer.
    const lat = 800;
    const run = new ScriptedRun(
      {
        talking: (_t: number, c: Ctx) =>
          c.phase === 'baselineTalking' ||
          (c.phase === 'listening' &&
            ((c.since >= 1_000 && c.since < 12_000) || (c.since >= 15_600 && c.since < 20_000))),
      },
      { questions: 1 },
    );
    run.engine.begin(0);
    run.runUntil(() => run.phase === 'listening', 200_000);
    const listenStart = run.phaseStart;
    // From here, deliver samples late and tick ahead of them.
    const step = 1000 / 30;
    let sampleT = run.t;
    for (let clock = run.t; clock < listenStart + 40_000; clock += step) {
      run.engine.tick(clock);
      while (sampleT <= clock - lat) {
        run.engine.ingest(run.sampleAt(Math.round(sampleT * 1000) / 1000));
        sampleT += step;
      }
    }
    const [r] = run.engine.snapshotNow().results.length ? run.engine.snapshotNow().results : [null];
    const ended = run.last('answerEnded');
    expect(ended).toBeDefined();
    // Ends ~4 s after the second stretch of talking (20 s), not during the 3.6 s pause.
    expect((ended as { tMs: number }).tMs - listenStart).toBeGreaterThan(23_500);
    if (r) expect(r.pauseCount).toBe(1);
  });

  it('"Skip to answering" during the question only skips the audio', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 1 });
    run.manualSpeech = true;
    run.engine.begin(0);
    run.runUntil(() => run.phase === 'asking', 200_000);
    run.engine.manualEndAnswer(run.t + 500);
    expect(run.engine.currentPhase).toBe('listening');
    expect(run.events.some((e) => e.type === 'answerEnded')).toBe(false);
    run.runTo(run.t + 60_000);
    const [r] = run.engine.snapshotNow().results;
    expect(r.answerStartMs).not.toBeNull();
    expect(r.talkTimeMs).toBeGreaterThan(15_000);
  });

  it('the Gate still settles when samples arrive late and in 1 s batches', () => {
    for (const { latency, batchMs } of [
      { latency: 1_200, batchMs: 33 },
      { latency: 300, batchMs: 1_000 },
      { latency: 1_400, batchMs: 1_000 },
    ]) {
      const run = new ScriptedRun({ talking: normalTalk }, { questions: 1 });
      run.engine.begin(0);
      run.runUntil(() => run.phase === 'listening', 200_000);
      const step = 1000 / 30;
      let sampleT = run.t;
      let delivered = run.t;
      for (let clock = run.t; clock < run.t + 120_000; clock += 100) {
        run.engine.tick(clock);
        // Deliver everything captured up to (clock - latency), but only at batch boundaries.
        const due = clock - latency;
        if (due - delivered >= batchMs || batchMs <= 100) {
          while (sampleT <= due) {
            run.engine.ingest(run.sampleAt(Math.round(sampleT * 1000) / 1000));
            sampleT += step;
          }
          delivered = due;
        }
        if (run.engine.snapshotNow().results.length > 0) break;
      }
      const [r] = run.engine.snapshotNow().results;
      expect(r?.recovery, `latency ${latency} ms, batches ${batchMs} ms`).toBe('settled');
      expect(Object.values(r.gate.outReasonMs ?? {}).reduce((a, b) => a + (b as number), 0)).toBeLessThan(
        45_000,
      );
    }
  });

  it('cue B leaves room for the one-sentence summary', () => {
    let cueAt: number | null = null;
    const run: ScriptedRun = new ScriptedRun(
      {
        talking: (t: number, c: Ctx): boolean =>
          c.phase === 'baselineTalking' ||
          (c.phase === 'listening' &&
            ((c.since >= 1_000 && cueAt === null) ||
              (cueAt !== null && t >= cueAt + 5_500 && t < cueAt + 9_500))),
      },
      { questions: 1 },
    );
    run.engine.on((e) => {
      if (e.type === 'cue' && e.event.cue === 'B') cueAt = e.event.tMs;
    });
    run.engine.begin(0);
    run.runTo(400_000);
    const [r] = run.engine.snapshotNow().results;
    expect(cueAt).not.toBeNull();
    // The summary (cue + 5.5 s .. cue + 9.5 s) is inside the answer.
    expect(r.answerEndMs as number).toBeGreaterThanOrEqual((cueAt ?? Number.POSITIVE_INFINITY) + 9_400);
    expect(r.series.talk.length).toBeGreaterThan(1);
  });

  it('a short sound that ended just before Listening is not an answer', () => {
    // A 300 ms "mm-hm" ends 150 ms before the question audio finishes; the real answer starts 15 s later.
    let listenAt: number | null = null;
    const run: ScriptedRun = new ScriptedRun(
      {
        talking: (t: number, c: Ctx): boolean =>
          c.phase === 'baselineTalking' ||
          (c.phase === 'asking' && c.since >= 1_550 && c.since < 1_850) ||
          (listenAt !== null && t >= listenAt + 15_000 && t < listenAt + 30_000),
      },
      { questions: 1 },
    );
    run.engine.on((e) => {
      if (e.type === 'phase' && e.phase === 'listening') listenAt = e.tMs;
    });
    run.engine.begin(0);
    run.runTo(300_000);
    const [r] = run.engine.snapshotNow().results;
    expect(r.timeToFirstWordMs as number).toBeGreaterThan(14_900);
    expect(r.talkTimeMs).toBeGreaterThan(14_000);
    expect(r.cues).toEqual([]);
  });

  it('end-of-answer survives late, batched packets (no clock jump on brief stalls)', () => {
    for (const { latency, batchMs } of [
      { latency: 800, batchMs: 1_000 },
      { latency: 1_400, batchMs: 1_000 },
      { latency: 1_600, batchMs: 100 },
    ]) {
      const run = new ScriptedRun(
        {
          talking: (_t: number, c: Ctx) =>
            c.phase === 'baselineTalking' ||
            (c.phase === 'listening' &&
              ((c.since >= 1_000 && c.since < 12_000) || (c.since >= 15_000 && c.since < 25_000))),
        },
        { questions: 1 },
      );
      run.engine.begin(0);
      run.runUntil(() => run.phase === 'listening', 200_000);
      const listenStart = run.phaseStart;
      const step = 1000 / 30;
      let sampleT = run.t;
      let delivered = run.t;
      for (let clock = run.t; clock < listenStart + 40_000; clock += 100) {
        run.engine.tick(clock);
        const due = clock - latency;
        if (due - delivered >= batchMs) {
          while (sampleT <= due) {
            run.engine.ingest(run.sampleAt(Math.round(sampleT * 1000) / 1000));
            sampleT += step;
          }
          delivered = due;
        }
      }
      const ended = run.last('answerEnded') as { tMs: number } | undefined;
      expect(ended, `latency ${latency}, batch ${batchMs}`).toBeDefined();
      // The 3 s pause (12-15 s) must not end the answer; it ends ~4 s after 25 s.
      expect(
        (ended as { tMs: number }).tMs - listenStart,
        `latency ${latency}, batch ${batchMs}`,
      ).toBeGreaterThan(28_500);
    }
  });

  it('ending the session during a Gate keeps the answer just given', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 2 });
    run.engine.begin(0);
    run.runUntil(() => run.phase === 'gate', 300_000);
    run.runTo(run.t + 1_000);
    run.engine.endSession(run.t);
    const snap = run.engine.snapshotNow();
    expect(snap.phase).toBe('debrief');
    expect(snap.results).toHaveLength(1);
    expect(snap.results[0].recovery).toBe('skipped');
    expect(snap.results[0].talkTimeMs).toBeGreaterThan(15_000);
    expect(snap.notes.some((n) => n.includes('after 1 of 2'))).toBe(true);
  });

  it('renders unusable signal spans as gaps (null), never numbers', () => {
    const run = new ScriptedRun(
      { talking: normalTalk, ok: (_t, c) => !listening(c, 15_000, 17_000) },
      { questions: 1 },
    );
    run.engine.begin(0);
    run.runTo(200_000);
    const [r] = run.engine.snapshotNow().results;
    const listenRel = r.series.marks.listenMs;
    const inGap = r.series.trace.filter(([t]) => t >= listenRel + 15_100 && t < listenRel + 16_900);
    expect(inGap.length).toBeGreaterThan(10);
    expect(inGap.every(([, v]) => v === null)).toBe(true);
    const pulseGap = r.series.pulse.filter(([t]) => t >= listenRel + 15_100 && t < listenRel + 16_000);
    expect(pulseGap.every(([, v]) => v === null)).toBe(true);
    expect(r.series.trace.filter(([, v]) => v !== null).length).toBeGreaterThan(100);
  });

  it('moves on after the TTS fallback estimate if speech end is never reported', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 1 });
    run.manualSpeech = true;
    run.engine.begin(0);
    run.runTo(80_000);
    const ph = run.events.filter((e) => e.type === 'phase') as { phase: string; tMs: number }[];
    const asking = ph.find((e) => e.phase === 'asking') as { tMs: number };
    const lis = ph.find((e) => e.phase === 'listening') as { tMs: number };
    // "Question number 1 please answer it." = 6 words → max(2500, 6×380) + 3000 slack
    expect(lis.tMs - asking.tMs).toBeGreaterThanOrEqual(5_500);
    expect(lis.tMs - asking.tMs).toBeLessThan(5_600);
  });

  it('manual end, skip Gate, and continue', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 2 });
    run.engine.begin(0);
    run.runUntil(() => run.phase === 'listening', 200_000);
    run.runTo(run.t + 5_000);
    run.engine.manualEndAnswer(run.t);
    expect(run.engine.currentPhase).toBe('gate');
    run.engine.skipGate(run.t + 10);
    expect(run.last('gateUnlocked')?.timedOut).toBe(false);
    expect(run.engine.snapshotNow().results[0].recovery).toBe('skipped');
    run.engine.continueAfterGate(run.t + 20);
    expect(run.engine.currentPhase).toBe('asking');
  });

  it('ending early goes to the debrief with completed questions only', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 3 });
    run.engine.begin(0);
    run.runUntil(() => run.engine.snapshotNow().results.length === 1, 300_000);
    run.engine.endSession(run.t);
    expect(run.engine.currentPhase).toBe('debrief');
    const snap = run.engine.snapshotNow();
    expect(snap.results).toHaveLength(1);
    expect(snap.notes.some((n) => n.includes('ended early'))).toBe(true);
  });

  it('holding the Recovered card waits for Continue', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 2 });
    run.engine.begin(0);
    run.runUntil(() => run.engine.snapshotNow().results.length === 1, 300_000);
    run.engine.holdAfterGate(run.t);
    run.runTo(run.t + 30_000);
    expect(run.engine.currentPhase).toBe('gate');
    expect(run.engine.snapshotNow().gate?.dwellRemainingMs).toBe(Number.POSITIVE_INFINITY);
    run.engine.continueAfterGate(run.t);
    expect(run.engine.currentPhase).toBe('asking');
  });

  it('camera-free mode: no baselines, paced pause, no physiology', () => {
    const run = new ScriptedRun(
      { talking: (_t, c) => listening(c, 1_000, 12_000), ok: () => false },
      { questions: 1, mode: 'camera-free' },
    );
    run.engine.begin(0);
    run.runTo(120_000);
    expect(run.phases()).toEqual(['asking', 'listening', 'gate', 'debrief']);
    const [r] = run.engine.snapshotNow().results;
    expect(r.recovery).toBe('paced pause');
    expect(r.gate.endMs - r.gate.startMs).toBeCloseTo(15_000, -2);
    expect(r.pulse.shown).toBe(false);
    expect(r.pulse.reason).toBe('camera off');
    expect(r.breathing.shown).toBe(false);
    expect(r.talkTimeMs).toBeGreaterThan(10_000);
  });

  it('snapshot reports arming and the live window', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 1 });
    run.engine.begin(0);
    run.runUntil(() => run.phase === 'listening', 200_000);
    run.runTo(run.t + 5_000);
    let snap = run.engine.snapshotNow();
    expect(snap.listening?.answerStarted).toBe(true);
    expect(snap.listening?.armed).toBe(false);
    run.runTo(run.t + 7_000);
    snap = run.engine.snapshotNow();
    expect(snap.listening?.armed).toBe(true);
    const live = run.engine.getLiveSamples();
    expect(live[live.length - 1].tMs - live[0].tMs).toBeLessThan(36_000);
  });

  it('builds a session record that round-trips and stays within the language rules', () => {
    const run = new ScriptedRun({ talking: normalTalk }, { questions: 2 });
    run.engine.begin(0);
    run.runTo(400_000);
    const rec = run.engine.buildRecord({
      id: 'test-1',
      createdAt: '2026-11-07T00:00:00Z',
      appVersion: '0.1.0',
    });
    const json = serializeSession(rec);
    const back = parseSession(json);
    expect(back.questions).toHaveLength(2);
    expect(back.baselines.band?.personal).toBe(true);
    expect(findBannedTerms(json)).toEqual([]);
    expect(() => parseSession('{"format":"nope"}')).toThrow();
  });
});
