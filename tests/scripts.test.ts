import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InterviewEngine } from '../src/engine/engine';
import { selectQuestions } from '../src/engine/questions';
import { serializeSession } from '../src/engine/session';
import { QUESTION_BANK } from '../src/content';
import { SimulatedSignalSource } from '../src/signals/SimulatedSignalSource';
import { runHeadless } from '../src/signals/headless';
import { ROOT } from './repoFiles';

describe('scripts/session-report.mjs', () => {
  it('summarizes a saved session and applies the 1-in-3 timeout rule', () => {
    const questions = selectQuestions(QUESTION_BANK, 4, 3);
    const engine = new InterviewEngine({ questions, mode: 'simulated' });
    const source = new SimulatedSignalSource({ seed: 3, scenario: 'timeout' });
    expect(runHeadless({ engine, source, autoContinue: true }).reachedDebrief).toBe(true);
    const rec = engine.buildRecord({
      id: 'report-test',
      createdAt: '2026-11-07T00:00:00.000Z',
      appVersion: 'test',
    });

    const dir = mkdtempSync(path.join(os.tmpdir(), 'composure-report-'));
    try {
      const file = path.join(dir, 'report-test.json');
      writeFileSync(file, serializeSession(rec));
      const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'session-report.mjs'), file], {
        encoding: 'utf8',
      });
      expect(out).toMatch(/Gates measured: 4/);
      expect(out).toMatch(/Q1\s+(settled|timed out)/);
      expect(out).toMatch(/closed by/);
      const timedOut = rec.questions.filter((q) => q.recovery === 'timed out').length;
      if (timedOut / 4 > 1 / 3) expect(out).toMatch(/Loosen in this order/);
      else expect(out).toMatch(/within the 1-in-3 rule/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
