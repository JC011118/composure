/**
 * Live interviewer cues. Fast signals trigger; slow signals only confirm.
 *
 * Cue A — "Take your time." (max once per question)
 *   trigger (fast): mid-answer silence longer than cueA.silenceMs
 *   confirm (slow): breathing rate measured over that silent span is above the
 *   SEATED baseline band (mean + max(k·SD, floor)). The SDK's breathing rate is
 *   used when it covers enough of the span; otherwise the rate implied by the
 *   trace's own breath cycles in the span is used.
 *
 * Cue B — "Let me stop you there — can you summarize in one sentence?"
 *   trigger: the answer has been going for cueB.talkMs and the user is still
 *   talking. Afterwards end-detection is (already) armed.
 *
 * A false positive costs one polite sentence; both cues are deliberately
 * harmless.
 *
 * Pure module.
 */

import type { CueAConfig, CueBConfig } from './config';
import type { MeanSd } from './stats';

export function rateBandUpper(seated: MeanSd, cfg: CueAConfig): number {
  return seated.mean + Math.max(cfg.rateBandSdMultiplier * seated.sd, cfg.minRateBandHalfWidth);
}

export interface CueAInput {
  answerStarted: boolean;
  ended: boolean;
  alreadyFired: boolean;
  talking: boolean;
  silenceMs: number | null;
  seatedRate: MeanSd | null;
  /** SDK breathing rate over the silent span (time-weighted). */
  sdkRateMean: number | null;
  sdkRateCoveredMs: number;
  /** Rate implied by the trace's breath cycles inside the span, if ≥ 2 cycles. */
  traceRate: number | null;
}

export interface CueADecision {
  fire: boolean;
  rate: number | null;
  upper: number | null;
  source: 'sdk' | 'trace' | null;
}

const NO: CueADecision = { fire: false, rate: null, upper: null, source: null };

export function decideCueA(input: CueAInput, cfg: CueAConfig): CueADecision {
  if (!input.answerStarted || input.ended || input.alreadyFired || input.talking) return NO;
  if (input.silenceMs === null || input.silenceMs <= cfg.silenceMs) return NO;
  if (!input.seatedRate) return NO;
  const upper = rateBandUpper(input.seatedRate, cfg);
  let rate: number | null = null;
  let source: CueADecision['source'] = null;
  if (input.sdkRateMean !== null && input.sdkRateCoveredMs >= cfg.minRateCoverageMs) {
    rate = input.sdkRateMean;
    source = 'sdk';
  } else if (input.traceRate !== null) {
    rate = input.traceRate;
    source = 'trace';
  }
  if (rate === null) return { fire: false, rate: null, upper, source: null };
  return { fire: rate > upper, rate, upper, source };
}

export interface CueBInput {
  answerElapsedMs: number | null;
  talking: boolean;
  ended: boolean;
  alreadyFired: boolean;
}

export function decideCueB(input: CueBInput, cfg: CueBConfig): boolean {
  if (input.ended || input.alreadyFired || !input.talking || input.answerElapsedMs === null) return false;
  return input.answerElapsedMs >= cfg.talkMs;
}
