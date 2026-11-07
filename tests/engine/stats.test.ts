import { describe, expect, it } from 'vitest';
import { clamp, gaussian, mean, meanSd, median, mulberry32, round, sd } from '../../src/engine/stats';

describe('stats', () => {
  it('mean / sd / median on known values', () => {
    expect(mean([])).toBeNull();
    expect(mean([2, 4, 6])).toBe(4);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sd([5])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(meanSd([1, 3])).toEqual({ mean: 2, sd: Math.SQRT2, n: 2 });
  });

  it('clamp and round', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(round(1.2345, 2)).toBe(1.23);
  });

  it('seeded PRNG is reproducible and roughly normal', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = mulberry32(7);
    const xs = Array.from({ length: 20000 }, () => gaussian(r));
    expect(mean(xs) as number).toBeCloseTo(0, 1);
    expect(sd(xs) as number).toBeCloseTo(1, 1);
  });
});
