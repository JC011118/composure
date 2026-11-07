import { describe, expect, it } from 'vitest';
import { SimulatedSignalSource } from '../../src/signals/SimulatedSignalSource';
import { ReplaySignalSource } from '../../src/signals/ReplaySignalSource';
import { ManualSignalSource } from '../../src/signals/ManualSignalSource';
import { parseRecording, recordToJson } from '../../src/signals/recording';
import type { SignalSample, SignalStatus } from '../../src/engine/types';

describe('recordToJson + replay', () => {
  it('round-trips a simulated run', () => {
    const sim = new SimulatedSignalSource({ seed: 21, dropoutsPerMinute: 2 });
    const tap = recordToJson(sim);
    sim.stepTo(15_000);
    tap.stop();
    sim.stepTo(16_000); // after stop: not recorded
    const json = tap.toJson('2026-11-07T00:00:00.000Z', 'unit test');
    const rec = parseRecording(json);
    expect(rec.source).toBe('simulated');
    expect(rec.samples.length).toBe(tap.sampleCount);
    expect(rec.samples[rec.samples.length - 1].tMs).toBeLessThanOrEqual(15_000);
    expect(rec.statuses.length).toBeGreaterThan(0);
    expect(json).not.toMatch(/frame|video|image/i);

    const replay = new ReplaySignalSource(rec);
    const out: SignalSample[] = [];
    const st: SignalStatus[] = [];
    let ended = false;
    replay.onSample((s) => out.push(s));
    replay.onStatus((s) => st.push(s));
    replay.onEnded(() => (ended = true));
    replay.stepTo(5_000);
    expect(ended).toBe(false);
    replay.stepTo(60_000);
    expect(ended).toBe(true);
    expect(out.length).toBe(rec.samples.length);
    expect(out[0].tMs).toBe(0);
    expect(st.length).toBe(rec.statuses.length);
    expect(out[10].breathingTrace).toBe(rec.samples[10].breathingTrace);
  });

  it('rejects malformed recordings', () => {
    expect(() => parseRecording('nope')).toThrow(/JSON/);
    expect(() => parseRecording('{"format":"x"}')).toThrow(/Composure/);
    expect(() =>
      parseRecording(JSON.stringify({ format: 'composure-signal-recording', version: 1, samples: [] })),
    ).toThrow(/no samples/);
    expect(() =>
      parseRecording(
        JSON.stringify({
          format: 'composure-signal-recording',
          version: 1,
          samples: [
            { tMs: 5, sdkConfidenceOk: true },
            { tMs: 1, sdkConfidenceOk: true },
          ],
        }),
      ),
    ).toThrow(/order/);
  });
});

describe('ManualSignalSource (camera-free)', () => {
  it('emits only talking, never physiology', () => {
    const src = new ManualSignalSource(() => 0);
    const out: SignalSample[] = [];
    src.onSample((s) => out.push(s));
    src.emitAt(0);
    src.setTalking(true);
    src.emitAt(100);
    expect(out).toEqual([
      { tMs: 0, talking: false, sdkConfidenceOk: false },
      { tMs: 100, talking: true, sdkConfidenceOk: false },
    ]);
  });
});
