import { describe, expect, it } from 'vitest';
import { buildInsightPrompt } from '../../src/engine/insightPrompt';
import { findBannedTerms } from '../../src/engine/lexicon';
import { ScriptedRun, type Ctx } from './helpers';

describe('LLM Insights prompt', () => {
  it('contains only baseline-relative numbers and the language rules', () => {
    const run = new ScriptedRun(
      {
        talking: (_t: number, c: Ctx) =>
          c.phase === 'baselineTalking' || (c.phase === 'listening' && c.since >= 1_000 && c.since < 20_000),
        pulse: (_t, c) => (c.phase === 'listening' ? 80 : 72),
      },
      { questions: 2 },
    );
    run.engine.begin(0);
    run.runTo(400_000);
    const prompt = buildInsightPrompt(
      run.engine.buildRecord({ id: 'x', createdAt: '2026-11-07T00:00:00Z', appVersion: '' }),
    );
    expect(prompt).toMatch(/Q1 \(behavioral\)/);
    expect(prompt).toMatch(/Q2 \(technical\)/);
    expect(prompt).toMatch(/pulse \+8 bpm vs talking baseline/);
    expect(prompt).toMatch(/do not give medical advice/i);
    expect(prompt).toMatch(/Do not label feelings/);
    expect(findBannedTerms(prompt)).toEqual([]);
    expect(prompt.length).toBeLessThanOrEqual(4000);
  });
});
