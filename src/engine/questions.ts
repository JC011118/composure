/**
 * Question bank validation and per-session selection. Pure module.
 */

import { mulberry32 } from './stats';
import type { Question } from './types';

export function validateQuestionBank(raw: unknown): Question[] {
  if (!Array.isArray(raw)) throw new Error('question bank must be an array');
  const seen = new Set<string>();
  return raw.map((q, i) => {
    const item = q as Partial<Question>;
    if (typeof item.id !== 'string' || !item.id) throw new Error(`question ${i}: missing id`);
    if (seen.has(item.id)) throw new Error(`question ${i}: duplicate id ${item.id}`);
    seen.add(item.id);
    if (typeof item.text !== 'string' || item.text.length < 10)
      throw new Error(`question ${item.id}: bad text`);
    if (item.tag !== 'behavioral' && item.tag !== 'technical')
      throw new Error(`question ${item.id}: bad tag`);
    if (item.difficulty !== 1 && item.difficulty !== 2 && item.difficulty !== 3) {
      throw new Error(`question ${item.id}: bad difficulty`);
    }
    return { id: item.id, text: item.text, tag: item.tag, difficulty: item.difficulty };
  });
}

/**
 * Pick `count` questions: a warm-up first, a hard one second, then the rest
 * alternating tags, shuffled deterministically by `seed`.
 */
export function selectQuestions(bank: readonly Question[], count: number, seed: number): Question[] {
  const rand = mulberry32(seed);
  const shuffled = [...bank];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const n = Math.max(1, Math.min(count, shuffled.length));
  const out: Question[] = [];
  const take = (pred: (q: Question) => boolean): void => {
    const idx = shuffled.findIndex(pred);
    if (idx >= 0) out.push(...shuffled.splice(idx, 1));
  };
  take((q) => q.difficulty === 1);
  if (out.length < n) take((q) => q.difficulty === 3);
  while (out.length < n && shuffled.length > 0) {
    const lastTag = out[out.length - 1]?.tag;
    const before = out.length;
    take((q) => q.tag !== lastTag);
    if (out.length === before) out.push(shuffled.shift() as Question);
  }
  return out.slice(0, n);
}
