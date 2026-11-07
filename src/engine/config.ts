/**
 * Every tunable constant in Composure lives here. Times are milliseconds
 * unless the name says otherwise. Tune these on real hardware (see
 * MORNING_CHECKLIST.md); `mergeConfig` lets a JSON override file passed with
 * `--config=<path>` change any subset without a rebuild.
 *
 * Pure module: no Electron, DOM, or Node imports.
 */

export interface SignalCheckConfig {
  /** Cumulative time with sdkConfidenceOk=true needed before the seated baseline starts. */
  minOkMs: number;
  /** Give up waiting and start the baseline anyway after this long (flagged in the debrief). */
  maxMs: number;
}

export interface BaselineConfig {
  /** Seated, silent baseline length. */
  seatedMs: number;
  /** Talking baseline length (user reads the on-screen passage aloud). */
  talkingMs: number;
  /** If less than this fraction of a baseline phase had a clean signal, extend it. */
  minValidCoverage: number;
  /** Extension step when coverage is too low. */
  extendStepMs: number;
  /** Maximum total extension per baseline phase. */
  maxExtendMs: number;
  /** Minimum breath half-cycle estimates needed for a personal Gate band. */
  minCycleEstimates: number;
  /** SDK breathing-rate confidence (0-100) treated as reliable (SDK `stable` threshold is 45). */
  breathingRateConfidenceMin: number;
  /** Fallback band used when the seated baseline has too few breath cycles. */
  fallbackPeriodMs: { lo: number; hi: number };
  /** Fallback amplitude band as a fraction of the observed median amplitude. */
  fallbackAmplitudeFrac: number;
}

export interface ListeningConfig {
  /** Continuous silence after speech that ends an answer (once armed). */
  endSilenceMs: number;
  /** End-detection arms only after the answer has run this long. */
  minAnswerMs: number;
  /** If the user never starts talking, close the question after this long. */
  noAnswerTimeoutMs: number;
  /** Hard cap on one answer. */
  maxAnswerMs: number;
  /** A silent gap at least this long inside an answer counts as a pause. */
  pauseMinMs: number;
  /** Raw talking=true must persist this long before we treat speech as started (flicker guard). */
  talkOnDebounceMs: number;
  /** Raw talking=false must persist this long before we treat speech as stopped. */
  talkOffDebounceMs: number;
}

export interface CueAConfig {
  /** Mid-answer silence longer than this can trigger the cue. */
  silenceMs: number;
  /** Seated breathing-rate band half-width = this × seated SD ... */
  rateBandSdMultiplier: number;
  /** ... but never narrower than this (breaths/min). */
  minRateBandHalfWidth: number;
  /** Breathing-rate readings must cover at least this much of the silent span to confirm. */
  minRateCoverageMs: number;
  /** After the cue, end-of-answer silence is counted from (cue time + graceMs). */
  graceMs: number;
  text: string;
}

export interface CueBConfig {
  /** Answer still going (and user talking) after this long triggers the cut-in. */
  talkMs: number;
  text: string;
}

export interface GateConfig {
  /** Target band = seated mean ± bandSdMultiplier × seated SD (period and amplitude). */
  bandSdMultiplier: number;
  /** Trace must stay inside the band this long to unlock. */
  holdMs: number;
  /** Unlock anyway after this long; the question is marked "recovery: timed out". */
  timeoutMs: number;
  /** Trace history fed to the Gate detector at Gate start so it can estimate the current cycle. */
  lookbackMs: number;
  /** Floor on the period band half-width (protects against a tiny seated SD). */
  minPeriodHalfWidthMs: number;
  /** Floor on the amplitude band half-width, as a fraction of the seated mean amplitude. */
  minAmplitudeHalfWidthFrac: number;
  /** Instantaneous trace excursion allowed beyond half the upper amplitude bound (×). */
  excursionTolerance: number;
  /** Time since the last breath turning point allowed, as (upper period / 2) × (1 + this). */
  turningPointSlack: number;
  /** How long the "Recovered" card stays up before the next question (user can skip). */
  postUnlockDwellMs: number;
}

export interface CycleConfig {
  /** Moving-average window applied to the raw trace before turning-point detection. */
  smoothingMs: number;
  /** Turning-point hysteresis as a fraction of the recent trace range. */
  hysteresisFrac: number;
  /** Window for the recent trace range. */
  rangeWindowMs: number;
  /** Period estimates outside [min, max] are discarded as artifacts. */
  minPeriodMs: number;
  maxPeriodMs: number;
}

export interface DebriefConfig {
  /** Pulse delta is shown only if clean pulse covers at least this fraction of the answer. */
  pulseCoverageMin: number;
  /** Pulse readings with SDK confidence below this (0-100) do not count (SDK `stable` threshold is 40). */
  pulseConfidenceMin: number;
  /** A sample "covers" at most this long when computing coverage. */
  maxSampleGapMs: number;
  /** Silent spans shorter than this are ignored for the breathing delta. */
  minSilentSpanMs: number;
  /** Total silent time with breathing readings needed for a breathing delta. */
  minBreathingSilentMs: number;
  /** Chart series downsampling for saved sessions. */
  traceSeriesHz: number;
  slowSeriesHz: number;
}

export interface AskingConfig {
  /** Fallback speech-duration estimate when the TTS engine never reports an end event. */
  msPerWord: number;
  minMs: number;
  fallbackSlackMs: number;
}

export interface HrvConfig {
  /** HRV readings at or above this confidence count as stable (SDK threshold is 50). */
  confidenceMin: number;
}

export interface CameraFreeConfig {
  /** Fixed paced pause that replaces the Gate when the camera is off. */
  pauseMs: number;
}

export interface EngineConfig {
  signalCheck: SignalCheckConfig;
  baseline: BaselineConfig;
  listening: ListeningConfig;
  cueA: CueAConfig;
  cueB: CueBConfig;
  gate: GateConfig;
  cycles: CycleConfig;
  debrief: DebriefConfig;
  asking: AskingConfig;
  hrv: HrvConfig;
  cameraFree: CameraFreeConfig;
}

export const DEFAULT_CONFIG: EngineConfig = {
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
  },
  cueA: {
    silenceMs: 6_000,
    rateBandSdMultiplier: 1.5,
    minRateBandHalfWidth: 1.0,
    minRateCoverageMs: 2_000,
    graceMs: 6_000,
    text: 'Take your time.',
  },
  cueB: {
    talkMs: 150_000,
    text: 'Let me stop you there — can you summarize in one sentence?',
  },
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
  hrv: { confidenceMin: 50 },
  cameraFree: { pauseMs: 15_000 },
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge an override onto a base config. Unknown keys and values whose
 * type does not match the base are ignored, so a typo in an override file
 * cannot inject garbage into the engine.
 */
export function mergeConfig(
  base: EngineConfig,
  override: DeepPartial<EngineConfig> | undefined | null,
): EngineConfig {
  const walk = (b: unknown, o: unknown): unknown => {
    if (!isPlainObject(b)) {
      return typeof o === typeof b ? o : b;
    }
    if (!isPlainObject(o)) return structuredCloneLike(b);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(b)) {
      out[key] = key in o ? walk(b[key], o[key]) : structuredCloneLike(b[key]);
    }
    return out;
  };
  return walk(base, override ?? {}) as EngineConfig;
}

function structuredCloneLike<T>(v: T): T {
  if (Array.isArray(v)) return v.map(structuredCloneLike) as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = structuredCloneLike(val);
    return out as T;
  }
  return v;
}
