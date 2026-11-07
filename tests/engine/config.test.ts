import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/engine/config';

describe('config', () => {
  it('has the spec constants', () => {
    expect(DEFAULT_CONFIG.gate.bandSdMultiplier).toBe(1.5);
    expect(DEFAULT_CONFIG.gate.holdMs).toBe(5000);
    expect(DEFAULT_CONFIG.gate.timeoutMs).toBe(45000);
    expect(DEFAULT_CONFIG.listening.endSilenceMs).toBe(4000);
    expect(DEFAULT_CONFIG.listening.minAnswerMs).toBe(10000);
    expect(DEFAULT_CONFIG.listening.pauseMinMs).toBe(1500);
    expect(DEFAULT_CONFIG.cueA.silenceMs).toBe(6000);
    expect(DEFAULT_CONFIG.cueB.talkMs).toBe(150000);
    expect(DEFAULT_CONFIG.baseline.seatedMs).toBe(30000);
    expect(DEFAULT_CONFIG.baseline.talkingMs).toBe(30000);
    expect(DEFAULT_CONFIG.debrief.pulseCoverageMin).toBe(0.6);
  });

  it('deep-merges overrides and ignores junk', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      gate: { holdMs: 4000, timeoutMs: 'oops' as unknown as number },
      // @ts-expect-error unknown section is ignored
      bogus: { x: 1 },
    });
    expect(merged.gate.holdMs).toBe(4000);
    expect(merged.gate.timeoutMs).toBe(45000);
    expect((merged as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(merged.cueA.text).toBe(DEFAULT_CONFIG.cueA.text);
    expect(DEFAULT_CONFIG.gate.holdMs).toBe(5000);
  });

  it('returns an independent copy', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, null);
    merged.baseline.fallbackPeriodMs.lo = 1;
    expect(DEFAULT_CONFIG.baseline.fallbackPeriodMs.lo).toBe(2500);
  });
});
