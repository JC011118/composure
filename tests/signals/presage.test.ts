import { describe, expect, it } from 'vitest';
import { MetricsNormalizer, tsToUs } from '../../src/signals/presageNormalize';
import { decodeInsight, encodeInsight } from '../../src/signals/insightCodec';

const ORIGIN = 1_790_000_000_000; // epoch ms
const us = (msFromOrigin: number) => (ORIGIN + msFromOrigin) * 1000;

describe('MetricsNormalizer', () => {
  it('emits one sample per trace entry with fresh slow signals and aligned talking', () => {
    const n = new MetricsNormalizer({ originEpochMs: ORIGIN });
    n.setStatusOk(true);
    const out = n.ingest({
      breathing: {
        rate: [{ value: 14.2, confidence: 80, timestamp: us(900) }],
        upperTrace: [
          { value: 0.1, timestamp: us(1000) },
          { value: 0.2, timestamp: us(1033) },
          { value: 0.3, timestamp: us(1066) },
        ],
      },
      cardio: {
        pulseRate: [{ value: 71, confidence: 88, timestamp: us(1000) }],
        hrv: [
          {
            rmssd: 40,
            sdnn: 50,
            meanNn: 840,
            baevsky: 120,
            confidence: 60,
            stable: true,
            timestamp: us(1000),
          },
        ],
      },
      face: {
        talking: [
          { detected: false, timestamp: us(990) },
          { detected: true, timestamp: us(1040) },
        ],
      },
    });
    expect(out.map((s) => s.tMs)).toEqual([1000, 1033, 1066]);
    expect(out.map((s) => s.talking)).toEqual([false, false, true]);
    expect(out[0]).toMatchObject({
      breathingTrace: 0.1,
      breathingRate: 14.2,
      breathingRateConfidence: 80,
      pulseBpm: 71,
      pulseConfidence: 88,
      sdkConfidenceOk: true,
    });
    expect(out[0].hrv).toMatchObject({ rmssd: 40, stable: true, baevsky: 120 });
  });

  it('never attaches numbers to non-OK samples and drops stale slow signals', () => {
    const n = new MetricsNormalizer({ originEpochMs: ORIGIN, freshMs: 2_500 });
    n.setStatusOk(true);
    n.ingest({ cardio: { pulseRate: [{ value: 70, confidence: 90, timestamp: us(0) }] } });
    n.setStatusOk(false);
    const bad = n.ingest({ breathing: { upperTrace: [{ value: 1, timestamp: us(500) }] } });
    expect(bad[0].sdkConfidenceOk).toBe(false);
    expect(bad[0].pulseBpm).toBeUndefined();
    n.setStatusOk(true);
    const stale = n.ingest({ breathing: { upperTrace: [{ value: 1, timestamp: us(4_000) }] } });
    expect(stale[0].pulseBpm).toBeUndefined();
  });

  it('keeps samples strictly increasing across packets and handles Long timestamps', () => {
    const n = new MetricsNormalizer({ originEpochMs: ORIGIN });
    n.setStatusOk(true);
    const long = (v: number) => ({ toNumber: () => v });
    const a = n.ingest({
      breathing: {
        upperTrace: [
          { value: 1, timestamp: long(us(100)) },
          { value: 2, timestamp: long(us(200)) },
        ],
      },
    });
    const b = n.ingest({
      breathing: {
        upperTrace: [
          { value: 3, timestamp: us(150) },
          { value: 4, timestamp: us(300) },
        ],
      },
    });
    expect(a.map((s) => s.tMs)).toEqual([100, 200]);
    expect(b.map((s) => s.tMs)).toEqual([300]);
    expect(tsToUs(null)).toBeNull();
    expect(tsToUs(0)).toBeNull();
  });

  it('still delivers talking when a packet has no trace', () => {
    const n = new MetricsNormalizer({ originEpochMs: ORIGIN });
    n.setStatusOk(true);
    const out = n.ingest({ face: { talking: [{ detected: true, timestamp: us(700) }] } }, us(700));
    expect(out).toEqual([{ tMs: 700, sdkConfidenceOk: true, talking: true }]);
  });
});

describe('Insight decoding', () => {
  it('round-trips the documented schema', () => {
    const buf = encodeInsight({
      requestId: 7,
      processedAt: '2026-11-07T08:00:00Z',
      analysis: 'Pulse rose 5 bpm on Q2.',
      type: 0,
    });
    expect(decodeInsight(buf)).toEqual({
      requestId: 7,
      processedAt: '2026-11-07T08:00:00Z',
      analysis: 'Pulse rose 5 bpm on Q2.',
      error: null,
      type: 0,
    });
    const err = decodeInsight(encodeInsight({ requestId: 3, error: 'quota', type: 0 }).buffer as ArrayBuffer);
    expect(err.error).toBe('quota');
    expect(err.analysis).toBeNull();
  });

  it('skips unknown fields and rejects truncated input', () => {
    const extra = new Uint8Array([...encodeInsight({ requestId: 1, analysis: 'ok' }), (9 << 3) | 0, 5]);
    expect(decodeInsight(extra).analysis).toBe('ok');
    expect(() => decodeInsight(new Uint8Array([(2 << 3) | 2, 10, 65]))).toThrow();
  });
});
