import { describe, expect, it } from 'vitest';
import { SimulatedSignalSource } from '../../src/signals/SimulatedSignalSource';
import type { EngineEvent, Phase, SignalSample, SignalStatus } from '../../src/engine/types';
import { mean } from '../../src/engine/stats';

function collect(src: SimulatedSignalSource) {
  const samples: SignalSample[] = [];
  const statuses: SignalStatus[] = [];
  src.onSample((s) => samples.push(s));
  src.onStatus((s) => statuses.push(s));
  return { samples, statuses };
}

const phase = (
  p: Phase,
  tMs: number,
  questionIndex = -1,
): EngineEvent => ({
  type: 'phase',
  phase: p,
  questionIndex,
  tMs,
});

/** Upward zero crossings of (trace - 6 s moving average), as breath periods in ms. */
function breathPeriods(samples: SignalSample[]): number[] {
  const xs = samples.filter((s) => s.sdkConfidenceOk && s.breathingTrace !== undefined);
  const win = 180;
  const crossings: number[] = [];
  let prev = 0;
  for (let i = win; i < xs.length; i++) {
    let m = 0;
    for (let j = i - win; j < i; j++) m += xs[j].breathingTrace as number;
    m /= win;
    // light smoothing
    const v =
      ((xs[i].breathingTrace as number) +
        (xs[i - 1].breathingTrace as number) +
        (xs[i - 2].breathingTrace as number)) /
        3 -
      m;
    if (prev < 0 && v >= 0) crossings.push(xs[i].tMs);
    prev = v;
  }
  const periods: number[] = [];
  for (let i = 1; i < crossings.length; i++) {
    const p = crossings[i] - crossings[i - 1];
    if (p > 1500) periods.push(p);
  }
  return periods;
}

describe('SimulatedSignalSource', () => {
  it('is deterministic for a seed', () => {
    const a = new SimulatedSignalSource({ seed: 11 });
    const b = new SimulatedSignalSource({ seed: 11 });
    const ca = collect(a);
    const cb = collect(b);
    a.stepTo(20_000);
    b.stepTo(20_000);
    expect(ca.samples).toEqual(cb.samples);
    expect(ca.samples.length).toBeGreaterThan(590);
  });

  it('starts with a camera-tuning warm-up, then OK', () => {
    const src = new SimulatedSignalSource({ seed: 3, dropoutsPerMinute: 0 });
    const { samples, statuses } = collect(src);
    src.stepTo(5_000);
    expect(statuses[0].code).toBe(10);
    expect(statuses[statuses.length - 1].code).toBe(0);
    expect(samples[0].sdkConfidenceOk).toBe(false);
    expect(samples[samples.length - 1].sdkConfidenceOk).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: quiet breath period is within 3-6 s', (seed) => {
    const src = new SimulatedSignalSource({ seed, dropoutsPerMinute: 0 });
    const { samples } = collect(src);
    src.observeEngine(phase('baselineSeated', 0));
    src.stepTo(90_000);
    const periods = breathPeriods(samples);
    expect(periods.length).toBeGreaterThan(10);
    const m = mean(periods) as number;
    expect(m).toBeGreaterThan(3_000);
    expect(m).toBeLessThan(6_000);
  });

  it('pulse stays within 55-100 bpm and its confidence dips while talking', () => {
    const src = new SimulatedSignalSource({ seed: 5, dropoutsPerMinute: 0 });
    const { samples } = collect(src);
    src.observeEngine(phase('baselineSeated', 0));
    src.stepTo(40_000);
    src.observeEngine(phase('baselineTalking', 40_000));
    src.stepTo(100_000);
    const pulses = samples.filter((s) => s.pulseBpm !== undefined);
    expect(pulses.length).toBeGreaterThan(1000);
    for (const s of pulses) {
      expect(s.pulseBpm as number).toBeGreaterThanOrEqual(55);
      expect(s.pulseBpm as number).toBeLessThanOrEqual(100);
    }
    const quietConf = mean(
      samples
        .filter((s) => s.tMs > 20_000 && s.tMs < 40_000 && s.pulseConfidence !== undefined)
        .map((s) => s.pulseConfidence as number),
    ) as number;
    const talkConf = mean(
      samples
        .filter((s) => s.tMs > 50_000 && s.tMs < 100_000 && s.pulseConfidence !== undefined)
        .map((s) => s.pulseConfidence as number),
    ) as number;
    expect(talkConf).toBeLessThan(quietConf - 10);
  });

  it('reads aloud during the talking baseline, with frame-level flicker', () => {
    const src = new SimulatedSignalSource({ seed: 9, dropoutsPerMinute: 0 });
    const { samples } = collect(src);
    src.observeEngine(phase('baselineTalking', 0));
    src.stepTo(30_000);
    const talkFrac = samples.filter((s) => s.talking).length / samples.length;
    expect(talkFrac).toBeGreaterThan(0.6);
    let toggles = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i].talking !== samples[i - 1].talking) toggles++;
    // Planned runs alone would toggle ~10 times in 30 s; flicker adds many more.
    expect(toggles).toBeGreaterThan(20);
  });

  it('answers after a short latency when listening begins', () => {
    const src = new SimulatedSignalSource({ seed: 4, dropoutsPerMinute: 0, scenario: 'steady' });
    const { samples } = collect(src);
    src.stepTo(10_000);
    src.observeEngine(phase('listening', 10_000, 0));
    src.stepTo(20_000);
    const firstTalk = samples.find((s) => s.tMs > 10_000 && s.talking);
    expect(firstTalk).toBeDefined();
    expect((firstTalk as SignalSample).tMs - 10_000).toBeGreaterThan(900);
    expect((firstTalk as SignalSample).tMs - 10_000).toBeLessThan(4_000);
  });

  it('hesitant answers go quiet after a short opener and breathe faster', () => {
    const src = new SimulatedSignalSource({ seed: 2, dropoutsPerMinute: 0, scenario: 'demo' });
    const { samples } = collect(src);
    src.observeEngine(phase('baselineSeated', 0));
    src.stepTo(40_000);
    src.observeEngine(phase('listening', 40_000, 1)); // demo question 2 is hesitant
    src.stepTo(60_000);
    const talkWindow = samples.filter((s) => s.tMs > 46_000 && s.tMs < 56_000);
    const talkFrac = talkWindow.filter((s) => s.talking).length / talkWindow.length;
    expect(talkFrac).toBeLessThan(0.1);
    expect(src.person.debugState().arousal).toBeGreaterThan(0.6);
  });

  it('produces dropouts as non-OK spans with a status', () => {
    const src = new SimulatedSignalSource({ seed: 6, dropoutsPerMinute: 3 });
    const { samples, statuses } = collect(src);
    src.stepTo(120_000);
    const after = samples.filter((s) => s.tMs > 5_000);
    expect(after.some((s) => !s.sdkConfidenceOk)).toBe(true);
    expect(statuses.some((s) => s.code === 12)).toBe(true);
    // Physiological numbers are never attached to a non-OK sample.
    for (const s of samples.filter((x) => !x.sdkConfidenceOk)) {
      expect(s.pulseBpm).toBeUndefined();
      expect(s.breathingRate).toBeUndefined();
    }
  });

  it('reports HRV only after about a minute of clean signal', () => {
    const src = new SimulatedSignalSource({ seed: 8, dropoutsPerMinute: 0 });
    const { samples } = collect(src);
    src.stepTo(100_000);
    expect(samples.filter((s) => s.tMs < 55_000).some((s) => s.hrv)).toBe(false);
    const late = samples.filter((s) => s.hrv);
    expect(late.length).toBeGreaterThan(0);
    expect(late[late.length - 1].hrv?.rmssd).toBeGreaterThan(10);
  });
});
