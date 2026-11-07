import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config';
import { computeBand, GateDetector, type BreathStats } from '../../src/engine/gate';
import { synthSamples, traceGen } from './helpers';

// Seated baseline: 4 s breaths, peak-to-trough amplitude 2.
const SEATED: BreathStats = {
  periodMeanMs: 4_000,
  periodSdMs: 200,
  ampMean: 2,
  ampSd: 0.1,
  nEstimates: 14,
  ampMedian: 2,
};
const BAND = computeBand(SEATED, DEFAULT_CONFIG.gate, DEFAULT_CONFIG.baseline);
const START = 60_000;

function gateOver(
  trace: (t: number) => number,
  opts: { seedHistory?: boolean; until?: number; ok?: (t: number) => boolean } = {},
) {
  const g = new GateDetector(BAND, DEFAULT_CONFIG.gate, DEFAULT_CONFIG.cycles, START);
  const all = synthSamples(START - 12_000, opts.until ?? START + 60_000, trace, (t) => ({
    sdkConfidenceOk: opts.ok ? opts.ok(t) : true,
  }));
  if (opts.seedHistory !== false) g.seed(all.filter((s) => s.tMs < START));
  for (const s of all) {
    if (s.tMs < START) continue;
    g.push(s);
    if (g.result) break;
  }
  return g;
}

describe('computeBand', () => {
  it('is seated mean ± 1.5 SD with floors', () => {
    expect(BAND.personal).toBe(true);
    // 1.5 × 200 ms = 300 ms is below the 400 ms floor, so the floor wins.
    expect(BAND.periodLoMs).toBe(3_600);
    expect(BAND.periodHiMs).toBe(4_400);
    // 1.5 × 0.1 = 0.15 is below the 15 % floor (0.3), so the floor wins.
    expect(BAND.ampLo).toBeCloseTo(1.7);
    expect(BAND.ampHi).toBeCloseTo(2.3);
    const wide = computeBand(
      { ...SEATED, periodSdMs: 600, ampSd: 0.4 },
      DEFAULT_CONFIG.gate,
      DEFAULT_CONFIG.baseline,
    );
    expect(wide.periodHiMs).toBe(4_900);
    expect(wide.ampHi).toBeCloseTo(2.6);
  });

  it('falls back to a wide band when the seated baseline had too few cycles', () => {
    const b = computeBand({ ...SEATED, nEstimates: 2 }, DEFAULT_CONFIG.gate, DEFAULT_CONFIG.baseline);
    expect(b.personal).toBe(false);
    expect(b.periodLoMs).toBe(2_500);
    expect(b.periodHiMs).toBe(8_000);
    expect(b.ampLo).toBeCloseTo(1);
    expect(b.ampHi).toBeCloseTo(3);
    const none = computeBand(null, DEFAULT_CONFIG.gate, DEFAULT_CONFIG.baseline);
    expect(none.ampHi).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('GateDetector', () => {
  it('a clean baseline-like trace unlocks in ~5 s', () => {
    const g = gateOver(traceGen({ periodMs: 4_000, amp: 1, noise: 0.01, seed: 2 }));
    expect(g.result).not.toBeNull();
    const r = g.result!;
    expect(r.outcome).toBe('settled');
    expect(r.timedOut).toBe(false);
    expect(r.endMs - START).toBeGreaterThanOrEqual(5_000);
    expect(r.endMs - START).toBeLessThan(6_000);
    expect(r.recoveryTimeMs).toBeLessThan(1_000);
  });

  it('a clean trace still unlocks quickly without trace history', () => {
    const g = gateOver(traceGen({ periodMs: 4_000, amp: 1, noise: 0.01, seed: 3 }), { seedHistory: false });
    expect(g.result?.outcome).toBe('settled');
    expect((g.result as { endMs: number }).endMs - START).toBeLessThan(5_000 + 2 * 4_000);
  });

  it('a noisy trace with 2× amplitude never unlocks before the 45 s timeout', () => {
    const g = gateOver(traceGen({ periodMs: 4_000, amp: 2, noise: 0.1, seed: 5 }), { until: START + 50_000 });
    const r = g.result!;
    expect(r.outcome).toBe('timed out');
    expect(r.timedOut).toBe(true);
    expect(r.recoveryTimeMs).toBeNull();
    expect(r.endMs - START).toBeGreaterThanOrEqual(45_000);
    expect(r.endMs - START).toBeLessThan(45_100);
    expect(r.inBandFraction).toBeLessThan(0.05);
  });

  it('fast elevated breathing that settles unlocks once it is back in band', () => {
    // 2× amplitude at 2.6 s breaths, easing to baseline around 12 s into the Gate.
    const settle = (t: number) => Math.min(1, Math.max(0, (t - START) / 12_000));
    const g = gateOver(
      traceGen({
        periodMs: (t) => 2_600 + 1_400 * settle(t),
        amp: (t) => 2 - settle(t),
        noise: 0.01,
        seed: 6,
      }),
    );
    const r = g.result!;
    expect(r.outcome).toBe('settled');
    expect(r.recoveryTimeMs).toBeGreaterThan(8_000);
    expect(r.recoveryTimeMs).toBeLessThan(20_000);
    expect(r.endMs - START - (r.recoveryTimeMs as number)).toBeGreaterThanOrEqual(5_000);
  });

  it('a signal gap breaks the streak', () => {
    const okFn = (t: number) => !(t >= START + 3_000 && t < START + 4_000);
    const g = gateOver(traceGen({ periodMs: 4_000, amp: 1, noise: 0.01, seed: 7 }), { ok: okFn });
    const r = g.result!;
    expect(r.outcome).toBe('settled');
    expect(r.endMs - START).toBeGreaterThan(4_000 + 5_000);
  });

  it('a held breath is out of band before the cycle completes', () => {
    const gen = traceGen({ periodMs: 4_000, amp: 1, noise: 0.005, seed: 8 });
    const hold = (t: number) => (t >= START + 1_000 ? 0.9 : gen(t));
    const g = gateOver(hold, { until: START + 20_000 });
    expect(g.result).toBeNull();
    expect(g.status.inBand).toBe(false);
    expect(['held', 'no-cycle']).toContain(g.status.outReason);
  });

  it('time passing without samples cannot unlock, but does time out', () => {
    const g = new GateDetector(BAND, DEFAULT_CONFIG.gate, DEFAULT_CONFIG.cycles, START);
    g.tick(START + 10_000);
    expect(g.result).toBeNull();
    expect(g.status.outReason).toBe('no-data');
    g.tick(START + 45_000);
    expect(g.result?.outcome).toBe('timed out');
  });

  it('reports a deviation that shrinks as the trace settles', () => {
    const wild = gateOver(traceGen({ periodMs: 4_000, amp: 2, noise: 0.01 }), { until: START + 10_000 });
    const calmish = gateOver(traceGen({ periodMs: 4_000, amp: 1, noise: 0.01 }), { until: START + 3_000 });
    expect(wild.status.deviation as number).toBeGreaterThan(1);
    expect(calmish.status.deviation as number).toBeLessThan(1);
  });
});
