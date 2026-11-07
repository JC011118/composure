/**
 * Shared engine types. Pure module.
 */

/** Session-level HRV reading, mirrored from the SDK's cardio.hrv[] entries. */
export interface HrvSample {
  rmssd: number;
  sdnn: number;
  meanNn: number;
  /** SDK's autonomic-balance index. Kept as a raw number; never labelled in the UI. */
  baevsky?: number;
  /** 0-100. */
  confidence: number;
  stable: boolean;
}

/**
 * One normalized signal sample. Every SignalSource (real SDK, simulator,
 * replay, manual) emits exactly this shape. `tMs` is milliseconds on the
 * source's own monotonic clock, starting near 0 when the source starts.
 */
export interface SignalSample {
  tMs: number;
  /** Breaths per minute (SDK breathing.rate[].value). */
  breathingRate?: number;
  /** 0-100 (SDK breathing.rate[].confidence). Optional extension of the base shape. */
  breathingRateConfidence?: number;
  /** Unitless chest-movement trace value (SDK breathing.upperTrace[].value). */
  breathingTrace?: number;
  /** Beats per minute (SDK cardio.pulseRate[].value). */
  pulseBpm?: number;
  /** 0-100 (SDK cardio.pulseRate[].confidence). */
  pulseConfidence?: number;
  /** SDK face.talking[].detected. */
  talking?: boolean;
  /** SDK face.blinking[].detected. */
  blinking?: boolean;
  /** SDK cardio.hrv[] latest entry. */
  hrv?: HrvSample;
  /**
   * False whenever the SDK says the capture is not usable (validation status
   * not OK, no data). Spans with false render as gaps and never as numbers.
   */
  sdkConfidenceOk: boolean;
}

/** Signal-quality status, driven by the SDK's validationStatus events. */
export interface SignalStatus {
  tMs: number;
  /** SDK ValidationCode integer (0 = OK). */
  code: number;
  /** Human-readable hint from the SDK, shown as-is. */
  hint: string;
}

export type QuestionTag = 'behavioral' | 'technical';

export interface Question {
  id: string;
  text: string;
  tag: QuestionTag;
  /** 1 (warm-up) .. 3 (hard). Used for ordering and by the simulator. */
  difficulty: 1 | 2 | 3;
}

export type Phase =
  | 'consent'
  | 'signalCheck'
  | 'baselineSeated'
  | 'baselineTalking'
  | 'asking'
  | 'listening'
  | 'gate'
  | 'debrief';

export type SpeechKind = 'intro' | 'question' | 'cueA' | 'cueB' | 'outro';

export type AnswerEndReason = 'silence' | 'manual' | 'maxLength' | 'noAnswer';

export type CueKind = 'A' | 'B';

export interface CueEvent {
  cue: CueKind;
  tMs: number;
  /** Supporting numbers at the moment the cue fired. */
  silenceMs?: number;
  breathingRateOverSpan?: number;
  rateBandUpper?: number;
  answerElapsedMs?: number;
}

export interface TalkSegment {
  startMs: number;
  endMs: number;
}

/** Engine → UI / simulator notifications. */
export type EngineEvent =
  | { type: 'phase'; phase: Phase; questionIndex: number; tMs: number }
  | { type: 'speak'; id: number; text: string; kind: SpeechKind; tMs: number }
  | { type: 'cue'; questionIndex: number; event: CueEvent }
  | { type: 'answerStarted'; questionIndex: number; tMs: number }
  | { type: 'answerEnded'; questionIndex: number; tMs: number; reason: AnswerEndReason }
  | {
      type: 'gateUnlocked';
      questionIndex: number;
      tMs: number;
      timedOut: boolean;
      recoveryTimeMs: number | null;
    }
  | { type: 'debriefReady'; tMs: number };

export type SignalMode = 'real' | 'simulated' | 'replay' | 'camera-free';
