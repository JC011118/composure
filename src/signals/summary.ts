/**
 * Compact, comparable summary of a debrief (used by the replay fixture test
 * and the fixture generator).
 */

import type { SessionRecord } from '../engine/session';

export interface DebriefSummary {
  questions: {
    id: string;
    endReason: string;
    cues: string[];
    recovery: string;
    timeToFirstWordMs: number | null;
    talkTimeMs: number;
    pauseCount: number;
    recoveryTimeMs: number | null;
    pulseShown: boolean;
    breathingShown: boolean;
  }[];
  bandPersonal: boolean | null;
  hrvPresent: boolean;
}

export function summarize(rec: SessionRecord): DebriefSummary {
  const r = (x: number | null) => (x === null ? null : Math.round(x));
  return {
    questions: rec.questions.map((q) => ({
      id: q.questionId,
      endReason: q.endReason,
      cues: q.cues.map((c) => c.cue),
      recovery: q.recovery,
      timeToFirstWordMs: r(q.timeToFirstWordMs),
      talkTimeMs: Math.round(q.talkTimeMs),
      pauseCount: q.pauseCount,
      recoveryTimeMs: r(q.recoveryTimeMs),
      pulseShown: q.pulse.shown,
      breathingShown: q.breathing.shown,
    })),
    bandPersonal: rec.baselines.band?.personal ?? null,
    hrvPresent: rec.hrv !== null,
  };
}
