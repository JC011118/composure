import { describe, expect, it } from 'vitest';
import { apiKeyFromEnv, parseCli } from '../../src/main/cli';

describe('cli mode selection', () => {
  it('simulator when no API key', () => {
    const o = parseCli([], {});
    expect(o.mode).toBe('simulated');
    expect(o.modeReason).toMatch(/PRESAGE_API_KEY/);
  });

  it('real when the key is present', () => {
    expect(parseCli([], { PRESAGE_API_KEY: 'k' }).mode).toBe('real');
    expect(parseCli([], { SMARTSPECTRA_API_KEY: 'k' }).mode).toBe('real');
  });

  it('--sim forces simulator even with a key', () => {
    const o = parseCli(['.', '--sim'], { PRESAGE_API_KEY: 'k' });
    expect(o.mode).toBe('simulated');
    expect(o.hasApiKey).toBe(true);
  });

  it('--replay wins', () => {
    const o = parseCli(['--replay=rec.json'], { PRESAGE_API_KEY: 'k' });
    expect(o.mode).toBe('replay');
    expect(o.replayFile).toBe('rec.json');
  });

  it('parses simulator flags and rejects bad values', () => {
    const o = parseCli(['--sim', '--sim-seed=7', '--sim-speed=4', '--sim-scenario=cueB', '--record'], {});
    expect(o.simSeed).toBe(7);
    expect(o.simSpeed).toBe(4);
    expect(o.simScenario).toBe('cueB');
    expect(o.recordSignals).toBe(true);
    const bad = parseCli(['--sim-speed=99', '--sim-scenario=nope'], {});
    expect(bad.simSpeed).toBe(1);
    expect(bad.simScenario).toBe('demo');
    expect(bad.warnings).toHaveLength(2);
  });

  it('a --sim-seed flag alone does not force simulator', () => {
    expect(parseCli(['--sim-seed=3'], { PRESAGE_API_KEY: 'k' }).mode).toBe('real');
  });

  it('trims and ignores blank keys', () => {
    expect(apiKeyFromEnv({ PRESAGE_API_KEY: '   ' })).toBeNull();
    expect(apiKeyFromEnv({ PRESAGE_API_KEY: ' abc ' })).toBe('abc');
  });
});
