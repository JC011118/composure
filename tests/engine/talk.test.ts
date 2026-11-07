import { describe, expect, it } from 'vitest';
import { AnswerTracker, TalkDebouncer } from '../../src/engine/talk';
import { TEST_CONFIG as DEFAULT_CONFIG } from './testConfig';

const L = DEFAULT_CONFIG.listening;

/** Feed a talking function into debouncer + tracker at 30 Hz, checking end conditions each frame. */
function simulate(
  talking: (t: number) => boolean,
  untilMs: number,
  onFrame?: (t: number, tr: AnswerTracker) => void,
) {
  const deb = new TalkDebouncer(L.talkOnDebounceMs, L.talkOffDebounceMs);
  const tr = new AnswerTracker(L, 0, false);
  for (let i = 0; i * (1000 / 30) <= untilMs; i++) {
    const t = Math.round(i * (1000 / 30) * 1000) / 1000;
    const edge = deb.push(t, talking(t));
    if (edge) tr.onEdge(edge);
    onFrame?.(t, tr);
    if (tr.check(t)) break;
  }
  return tr;
}

describe('TalkDebouncer', () => {
  it('ignores sub-debounce flicker and back-dates edges', () => {
    const d = new TalkDebouncer(150, 350);
    const edges: { talking: boolean; edgeMs: number }[] = [];
    const raw = (t: number) =>
      (t >= 1_000 && t < 5_000 && !(t >= 2_000 && t < 2_200)) || (t >= 8_000 && t < 8_100);
    for (let t = 0; t < 10_000; t += 10) {
      const e = d.push(t, raw(t));
      if (e) edges.push(e);
    }
    expect(edges).toEqual([
      { talking: true, edgeMs: 1_000 },
      { talking: false, edgeMs: 5_000 },
    ]);
  });

  it('treats a missing talking flag as silence', () => {
    const d = new TalkDebouncer(0, 100);
    d.push(0, true);
    expect(d.talking).toBe(true);
    d.push(50, undefined);
    expect(d.push(200, undefined)).toEqual({ talking: false, edgeMs: 50 });
  });
});

describe('AnswerTracker', () => {
  it('ends after 4 s of silence following speech', () => {
    const tr = simulate((t) => t >= 2_000 && t < 15_000, 60_000);
    expect(tr.answerStartMs).toBeCloseTo(2_000, -2);
    expect(tr.ended?.reason).toBe('silence');
    expect((tr.ended?.tMs as number) - 15_000).toBeGreaterThanOrEqual(4_000);
    expect((tr.ended?.tMs as number) - 15_000).toBeLessThan(4_100);
  });

  it('does not arm end-detection before the 10 s minimum answer length', () => {
    // Speaks 1-3 s, then silent. Silence reaches 4 s at 7 s, but end-detection only arms at 11 s
    // and then needs 4 s of silence while armed: the answer ends at 15 s.
    let endedBeforeArm = false;
    const tr = simulate(
      (t) => t >= 1_000 && t < 3_000,
      60_000,
      (t, x) => {
        if (t < 10_900 && x.ended) endedBeforeArm = true;
      },
    );
    expect(endedBeforeArm).toBe(false);
    expect(tr.armed(11_100)).toBe(true);
    expect(tr.ended?.reason).toBe('silence');
    expect(tr.ended?.tMs as number).toBeGreaterThanOrEqual(15_000);
    expect(tr.ended?.tMs as number).toBeLessThan(15_100);
  });

  it('cue A pushes the end clock out so the answer is not closed right after the cue', () => {
    const tr = simulate(
      (t) => t >= 1_000 && t < 3_000,
      60_000,
      (t, x) => {
        if (t >= 9_100 && !x.hasCue('A')) x.recordCue({ cue: 'A', tMs: t }, t + DEFAULT_CONFIG.cueA.graceMs);
      },
    );
    // Floor = 9.1 + 6 = 15.1 s; end = floor + 4 s.
    expect(tr.ended?.tMs as number).toBeGreaterThanOrEqual(19_100);
    expect(tr.ended?.tMs as number).toBeLessThan(19_200);
  });

  it('counts pauses of at least 1.5 s and sums talk time', () => {
    const talking = (t: number) =>
      (t >= 1_000 && t < 5_000) ||
      (t >= 6_000 && t < 9_000) ||
      (t >= 11_000 && t < 14_000) ||
      (t >= 16_500 && t < 20_000);
    const tr = simulate(talking, 60_000);
    // Gaps: 1.0 s (not a pause), 2.0 s, 2.5 s.
    expect(tr.pauses().length).toBe(2);
    expect(tr.talkTimeMs()).toBeGreaterThan(13_400);
    expect(tr.talkTimeMs()).toBeLessThan(13_600);
  });

  it('closes a silent question after the no-answer timeout', () => {
    const tr = simulate(() => false, 70_000);
    expect(tr.ended?.reason).toBe('noAnswer');
    expect(tr.ended?.tMs as number).toBeGreaterThanOrEqual(60_000);
    expect(tr.answerStarted).toBe(false);
  });

  it('caps very long answers', () => {
    const tr = simulate((t) => t >= 500, 300_000);
    expect(tr.ended?.reason).toBe('maxLength');
  });

  it('starts the answer at listening start if the user is already talking', () => {
    const tr = new AnswerTracker(L, 5_000, true);
    expect(tr.answerStartMs).toBe(5_000);
    expect(tr.talking).toBe(true);
  });
});
