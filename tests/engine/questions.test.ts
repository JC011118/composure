import { describe, expect, it } from 'vitest';
import { QUESTION_BANK, READING_PASSAGE } from '../../src/content';
import { selectQuestions, validateQuestionBank } from '../../src/engine/questions';

describe('question bank', () => {
  it('has 12 questions tagged behavioral/technical', () => {
    expect(QUESTION_BANK).toHaveLength(12);
    expect(QUESTION_BANK.filter((q) => q.tag === 'behavioral')).toHaveLength(6);
    expect(QUESTION_BANK.filter((q) => q.tag === 'technical')).toHaveLength(6);
  });

  it('rejects malformed banks', () => {
    expect(() => validateQuestionBank({})).toThrow();
    expect(() =>
      validateQuestionBank([{ id: 'a', text: 'short', tag: 'behavioral', difficulty: 1 }]),
    ).toThrow();
    expect(() =>
      validateQuestionBank([
        { id: 'a', text: 'A long enough question?', tag: 'behavioral', difficulty: 1 },
        { id: 'a', text: 'A long enough question?', tag: 'technical', difficulty: 1 },
      ]),
    ).toThrow(/duplicate/);
  });

  it('selects a warm-up first, a hard question second, deterministically', () => {
    const a = selectQuestions(QUESTION_BANK, 5, 42);
    const b = selectQuestions(QUESTION_BANK, 5, 42);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a[0].difficulty).toBe(1);
    expect(a[1].difficulty).toBe(3);
    expect(new Set(a.map((q) => q.id)).size).toBe(5);
    expect(selectQuestions(QUESTION_BANK, 99, 1)).toHaveLength(12);
  });

  it('has a reading passage of about 30 seconds', () => {
    const words = READING_PASSAGE.split(/\s+/).length;
    expect(words).toBeGreaterThan(75);
    expect(words).toBeLessThan(140);
  });
});
