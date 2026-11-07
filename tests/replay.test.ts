import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { InterviewEngine } from '../src/engine/engine';
import { selectQuestions } from '../src/engine/questions';
import { findBannedTerms } from '../src/engine/lexicon';
import { parseSession, serializeSession } from '../src/engine/session';
import { QUESTION_BANK } from '../src/content';
import { SimulatedSignalSource } from '../src/signals/SimulatedSignalSource';
import { parseRecording } from '../src/signals/recording';
import { runHeadless } from '../src/signals/headless';
import { replaySession } from '../src/signals/replaySession';
import { summarize } from '../src/signals/summary';

const META = { id: 'e2e', createdAt: '2026-11-07T00:00:00.000Z', appVersion: 'test' };

describe('end-to-end simulated session', () => {
  it('runs consent → debrief through the engine and produces a debrief JSON', () => {
    const questions = selectQuestions(QUESTION_BANK, 5, 11);
    const source = new SimulatedSignalSource({ seed: 11, scenario: 'full' });
    const engine = new InterviewEngine({ questions, mode: 'simulated' });
    const run = runHeadless({ engine, source, autoContinue: true });
    expect(run.reachedDebrief).toBe(true);

    const record = engine.buildRecord(META);
    const json = serializeSession(record);
    const back = parseSession(json);

    expect(back.questions).toHaveLength(5);
    expect(back.baselines.seated?.breath?.nEstimates).toBeGreaterThan(6);
    expect(back.baselines.band?.personal).toBe(true);
    // Scenario "full": q2 rambles past 2:30 (cue B), q3 goes quiet on a hard question (cue A).
    expect(back.questions[1].cues.map((c) => c.cue)).toContain('B');
    expect(back.questions[2].cues.map((c) => c.cue)).toContain('A');
    for (const q of back.questions) {
      expect(['settled', 'timed out']).toContain(q.recovery);
      expect(q.timeToFirstWordMs).not.toBeNull();
      expect(q.talkTimeMs).toBeGreaterThan(3_000);
      expect(q.series.trace.length).toBeGreaterThan(100);
      if (q.pulse.shown) expect(q.pulse.coverage).toBeGreaterThanOrEqual(0.6);
      else expect(q.pulse.reason).toBe('not enough clean signal');
    }
    expect(back.hrv).not.toBeNull();
    expect(typeof back.hrv?.stable).toBe('boolean');
    // Language rules hold for everything the debrief can render.
    expect(findBannedTerms(json)).toEqual([]);
    // No frames or media of any kind in the saved record.
    expect(json).not.toMatch(/data:image|base64|"frame|video/i);
  });

  const dir = path.resolve(__dirname, '..', 'fixtures', 'replays');
  const fixtures = readdirSync(dir)
    .filter((f) => f.endsWith('.recording.json'))
    .map((f) => f.slice(0, -'.recording.json'.length))
    .filter((name) => existsSync(path.join(dir, `${name}.expected.json`)));

  it('has at least one replay fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('replaying fixture %s reproduces its debrief exactly', (name) => {
    const recording = parseRecording(readFileSync(path.join(dir, `${name}.recording.json`), 'utf8'));
    const expected = JSON.parse(readFileSync(path.join(dir, `${name}.expected.json`), 'utf8'));
    const { run, record } = replaySession(recording, QUESTION_BANK);
    expect(run.reachedDebrief).toBe(true);
    expect(summarize(record)).toEqual(expected);
  });
});
