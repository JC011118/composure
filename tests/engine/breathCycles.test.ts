import { describe, expect, it } from 'vitest';
import { BreathCycleDetector, type CycleEstimate } from '../../src/engine/breathCycles';
import { DEFAULT_CONFIG } from '../../src/engine/config';
import { mean } from '../../src/engine/stats';
import { synthSamples, traceGen } from './helpers';

function run(samples: ReturnType<typeof synthSamples>): CycleEstimate[] {
  const d = new BreathCycleDetector(DEFAULT_CONFIG.cycles);
  const out: CycleEstimate[] = [];
  for (const s of samples) {
    const e = d.push(s.tMs, s.breathingTrace, s.sdkConfidenceOk);
    if (e) out.push(e);
  }
  return out;
}

describe('BreathCycleDetector', () => {
  it('measures period and peak-to-trough amplitude of a clean 4 s breath', () => {
    const est = run(synthSamples(0, 60_000, traceGen({ periodMs: 4_000, amp: 1 })));
    expect(est.length).toBeGreaterThan(24);
    expect(mean(est.map((e) => e.periodMs)) as number).toBeCloseTo(4_000, -2);
    for (const e of est) {
      expect(Math.abs(e.periodMs - 4_000)).toBeLessThan(80);
      expect(e.amplitude).toBeGreaterThan(1.9);
      expect(e.amplitude).toBeLessThan(2.05);
    }
  });

  it('tracks a 3 s and a 6 s breath', () => {
    for (const p of [3_000, 6_000]) {
      const est = run(synthSamples(0, 60_000, traceGen({ periodMs: p, amp: 0.5 })));
      expect(Math.abs((mean(est.map((e) => e.periodMs)) as number) - p)).toBeLessThan(60);
    }
  });

  it('is robust to noise and slow drift', () => {
    const est = run(
      synthSamples(0, 90_000, traceGen({ periodMs: 4_500, amp: 1, noise: 0.05, drift: 0.3, seed: 4 })),
    );
    const periods = est.map((e) => e.periodMs);
    expect(Math.abs((mean(periods) as number) - 4_500)).toBeLessThan(150);
    expect(Math.abs((mean(est.map((e) => e.amplitude)) as number) - 2)).toBeLessThan(0.2);
  });

  it('never measures a cycle across a signal gap', () => {
    const gen = traceGen({ periodMs: 4_000, amp: 1 });
    const samples = synthSamples(0, 40_000, gen).map((s) =>
      s.tMs >= 15_000 && s.tMs < 18_000 ? { ...s, sdkConfidenceOk: false } : s,
    );
    const est = run(samples);
    for (const e of est) {
      expect(e.pointMs - e.periodMs >= 18_000 || e.pointMs < 15_000).toBe(true);
    }
    // Recovers after the gap.
    expect(est.some((e) => e.pointMs > 25_000)).toBe(true);
  });

  it('reports a center line between the latest peak and trough', () => {
    const d = new BreathCycleDetector(DEFAULT_CONFIG.cycles);
    const gen = traceGen({ periodMs: 4_000, amp: 1 });
    for (const s of synthSamples(0, 20_000, (t) => gen(t) + 5)) d.push(s.tMs, s.breathingTrace, true);
    expect(d.center as number).toBeCloseTo(5, 1);
  });
});
