/**
 * Debrief results and the saved-session JSON format.
 *
 * A session record holds numbers only: timings, baseline statistics,
 * baseline-relative deltas, cue events, Gate outcomes, and downsampled chart
 * series where unusable spans are null gaps. No frames, video, or audio.
 *
 * Pure module.
 */

import type { BaselineStats } from './baseline';
import type { EngineConfig } from './config';
import type { Band, GateResult } from './gate';
import type { SeriesPoint } from './metrics';
import type { AnswerEndReason, CueEvent, QuestionTag, SignalMode, TalkSegment } from './types';

export const NOT_ENOUGH_SIGNAL = 'not enough clean signal';

export interface PulseResult {
  /** Mean clean pulse during the answer minus the TALKING baseline mean. Null when not shown. */
  deltaBpm: number | null;
  meanBpm: number | null;
  /** Fraction of the answer covered by clean pulse readings (0..1). */
  coverage: number;
  shown: boolean;
  /** Why it is not shown. */
  reason: string | null;
}

export interface BreathingResult {
  /** Mean breathing rate over silent spans minus the SEATED baseline mean. Null when not shown. */
  deltaBrPerMin: number | null;
  meanBrPerMin: number | null;
  /** Silent time with clean breathing-rate readings. */
  silentCoveredMs: number;
  shown: boolean;
  reason: string | null;
}

export interface QuestionSeries {
  /** Series start (absolute engine time); point times are relative to this. */
  startMs: number;
  /** Breathing trace, gaps as null. */
  trace: SeriesPoint[];
  /** Pulse (clean readings only), gaps as null. */
  pulse: SeriesPoint[];
  /** Breathing rate, gaps as null. */
  breathingRate: SeriesPoint[];
  /** Talk segments relative to startMs. */
  talk: TalkSegment[];
  /** Phase boundaries relative to startMs. */
  marks: { listenMs: number; gateMs: number; endMs: number };
}

export interface QuestionResult {
  index: number;
  questionId: string;
  text: string;
  tag: QuestionTag;
  askStartMs: number;
  listenStartMs: number;
  answerStartMs: number | null;
  answerEndMs: number | null;
  listenEndMs: number;
  endReason: AnswerEndReason;
  timeToFirstWordMs: number | null;
  talkTimeMs: number;
  pauseCount: number;
  pausesMs: number[];
  cues: CueEvent[];
  gate: GateResult;
  /** Debrief label: "settled", "timed out", "paced pause", "skipped". */
  recovery: GateResult['outcome'];
  recoveryTimeMs: number | null;
  pulse: PulseResult;
  breathing: BreathingResult;
  series: QuestionSeries;
}

export interface SessionHrv {
  rmssd: number;
  sdnn: number;
  meanNn: number;
  confidence: number;
  stable: boolean;
  tMs: number;
}

export interface InsightRecord {
  prompt: string;
  requestId: number;
  processedAt: string;
  /** Already passed through redactBannedTerms. */
  analysis: string | null;
  error: string | null;
}

export interface SessionRecord {
  format: 'composure-session';
  version: 1;
  id: string;
  createdAt: string;
  mode: SignalMode;
  /** For replays: the kind of source the recording came from. */
  replayOf?: SignalMode;
  appVersion: string;
  config: EngineConfig;
  signalCheck: { durationMs: number; timedOut: boolean } | null;
  baselines: { seated: BaselineStats | null; talking: BaselineStats | null; band: Band | null };
  questions: QuestionResult[];
  hrv: SessionHrv | null;
  insights: InsightRecord[];
  notes: string[];
}

export interface SessionMeta {
  id: string;
  createdAt: string;
  appVersion: string;
  /** For replays: the kind of source the recording came from (e.g. 'simulated'). */
  replayOf?: SignalMode;
}

export function serializeSession(record: SessionRecord): string {
  return JSON.stringify(record, (_k, v: unknown) => (v === Number.POSITIVE_INFINITY ? null : v));
}

/** Parse a saved session. Throws a readable error on anything that is not one. */
export function parseSession(json: string): SessionRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Session file is not valid JSON');
  }
  const rec = raw as Partial<SessionRecord>;
  if (!rec || rec.format !== 'composure-session') throw new Error('Not a Composure session');
  if (rec.version !== 1) throw new Error(`Unsupported session version ${String(rec.version)}`);
  if (typeof rec.id !== 'string' || !Array.isArray(rec.questions))
    throw new Error('Session is missing fields');
  return {
    ...(rec as SessionRecord),
    insights: Array.isArray(rec.insights) ? rec.insights : [],
    notes: Array.isArray(rec.notes) ? rec.notes : [],
  };
}
