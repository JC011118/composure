import { describe, expect, it } from 'vitest';
import { decideCueA, decideCueB, rateBandUpper } from '../../src/engine/cues';
import { DEFAULT_CONFIG } from '../../src/engine/config';

const A = DEFAULT_CONFIG.cueA;
const seated = { mean: 14, sd: 0.5, n: 300 };
const base = {
  answerStarted: true,
  ended: false,
  alreadyFired: false,
  talking: false,
  silenceMs: 7_000,
  seatedRate: seated,
  sdkRateMean: 17,
  sdkRateCoveredMs: 6_000,
  traceRate: null,
};

describe('cue A', () => {
  it('band upper uses k·SD with a floor', () => {
    expect(rateBandUpper(seated, A)).toBe(15); // 1.5 × 0.5 = 0.75 < floor 1.0
    expect(rateBandUpper({ mean: 14, sd: 2, n: 10 }, A)).toBe(17);
  });

  it('fires on a long silence with breathing above the seated band', () => {
    const d = decideCueA(base, A);
    expect(d).toEqual({ fire: true, rate: 17, upper: 15, source: 'sdk' });
  });

  it('does not fire when breathing is inside the band', () => {
    expect(decideCueA({ ...base, sdkRateMean: 14.6 }, A).fire).toBe(false);
  });

  it('does not fire on short silence, while talking, before the answer, after it ended, or twice', () => {
    expect(decideCueA({ ...base, silenceMs: 5_900 }, A).fire).toBe(false);
    expect(decideCueA({ ...base, silenceMs: 6_000 }, A).fire).toBe(false);
    expect(decideCueA({ ...base, talking: true }, A).fire).toBe(false);
    expect(decideCueA({ ...base, answerStarted: false }, A).fire).toBe(false);
    expect(decideCueA({ ...base, ended: true }, A).fire).toBe(false);
    expect(decideCueA({ ...base, alreadyFired: true }, A).fire).toBe(false);
  });

  it('prefers the rate measured from breath cycles inside the silent span', () => {
    const d = decideCueA({ ...base, sdkRateCoveredMs: 500, traceRate: 19 }, A);
    expect(d.fire).toBe(true);
    expect(d.source).toBe('trace');
    // The lagging SDK rate does not override an in-band trace rate.
    expect(decideCueA({ ...base, traceRate: 14.2 }, A)).toMatchObject({ fire: false, source: 'trace' });
  });

  it('falls back to the SDK rate when no breath cycles completed, if it covers the span', () => {
    expect(decideCueA({ ...base, traceRate: null }, A)).toMatchObject({ fire: true, source: 'sdk' });
    expect(decideCueA({ ...base, sdkRateCoveredMs: 500, traceRate: null }, A).fire).toBe(false);
  });

  it('never fires without a seated baseline rate', () => {
    expect(decideCueA({ ...base, seatedRate: null }, A).fire).toBe(false);
  });
});

describe('cue B', () => {
  const B = DEFAULT_CONFIG.cueB;
  it('fires after 2:30 of answer while still talking, once', () => {
    expect(
      decideCueB({ answerElapsedMs: 149_000, talking: true, ended: false, alreadyFired: false }, B),
    ).toBe(false);
    expect(
      decideCueB({ answerElapsedMs: 150_000, talking: true, ended: false, alreadyFired: false }, B),
    ).toBe(true);
    expect(
      decideCueB({ answerElapsedMs: 160_000, talking: false, ended: false, alreadyFired: false }, B),
    ).toBe(false);
    expect(decideCueB({ answerElapsedMs: 160_000, talking: true, ended: false, alreadyFired: true }, B)).toBe(
      false,
    );
  });
});
