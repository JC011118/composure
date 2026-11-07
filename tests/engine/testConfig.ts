/**
 * Tests pin their own copy of the constants they were written against, so
 * tuning src/engine/config.ts on real hardware (MORNING_CHECKLIST.md) does not
 * break unrelated behavior tests. tests/engine/config.test.ts is the one place
 * that checks DEFAULT_CONFIG itself against the brief's spec values.
 */
import { DEFAULT_CONFIG, mergeConfig, type DeepPartial, type EngineConfig } from '../../src/engine/config';

const PINNED: DeepPartial<EngineConfig> = {
  signalCheck: { minOkMs: 5_000, maxMs: 60_000 },
  baseline: {
    seatedMs: 30_000,
    talkingMs: 30_000,
    minValidCoverage: 0.6,
    extendStepMs: 10_000,
    maxExtendMs: 30_000,
    minCycleEstimates: 6,
    breathingRateConfidenceMin: 45,
    fallbackPeriodMs: { lo: 2_500, hi: 8_000 },
    fallbackAmplitudeFrac: 0.5,
  },
  listening: {
    endSilenceMs: 4_000,
    minAnswerMs: 10_000,
    noAnswerTimeoutMs: 60_000,
    maxAnswerMs: 240_000,
    pauseMinMs: 1_500,
    talkOnDebounceMs: 150,
    talkOffDebounceMs: 350,
    stallMs: 2_500,
  },
  cueA: {
    silenceMs: 6_000,
    rateBandSdMultiplier: 1.5,
    minRateBandHalfWidth: 1.0,
    minRateCoverageMs: 2_000,
    graceMs: 6_000,
  },
  cueB: { talkMs: 150_000, graceMs: 3_000 },
  gate: {
    bandSdMultiplier: 1.5,
    holdMs: 5_000,
    timeoutMs: 45_000,
    lookbackMs: 12_000,
    minPeriodHalfWidthMs: 400,
    minAmplitudeHalfWidthFrac: 0.15,
    excursionTolerance: 1.15,
    turningPointSlack: 0.75,
    postUnlockDwellMs: 6_000,
    stallMs: 2_500,
  },
  cycles: {
    smoothingMs: 250,
    hysteresisFrac: 0.3,
    rangeWindowMs: 12_000,
    minPeriodMs: 1_500,
    maxPeriodMs: 15_000,
  },
  debrief: {
    pulseCoverageMin: 0.6,
    pulseConfidenceMin: 40,
    maxSampleGapMs: 2_000,
    minSilentSpanMs: 1_500,
    minBreathingSilentMs: 5_000,
    traceSeriesHz: 10,
    slowSeriesHz: 1,
  },
  asking: { msPerWord: 380, minMs: 2_500, fallbackSlackMs: 3_000 },
  cameraFree: { pauseMs: 15_000 },
};

export const TEST_CONFIG: EngineConfig = mergeConfig(DEFAULT_CONFIG, PINNED);
