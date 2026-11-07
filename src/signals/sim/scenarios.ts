/**
 * How the simulated person behaves on each question. Scenarios are picked
 * with `--sim-scenario=<name>`; question i uses entry i (wrapping).
 */

export type AnswerStyle =
  /** 22-40 s of speech with natural pauses. */
  | 'normal'
  /** Short opener, then a long silence with faster breathing (exercises cue A). */
  | 'hesitant'
  /** Talks past 2:30 until cut off, then summarizes (exercises cue B). */
  | 'rambling'
  /** About 6 s of speech (exercises the 10 s minimum answer length). */
  | 'brief';

/** How quickly breathing settles back toward baseline during the Gate. */
export type GateStyle = 'fast' | 'normal' | 'slow';

/** Pulse confidence while talking: 'good' mostly ≥ 40, 'poor' mostly < 40. */
export type PulseQuality = 'good' | 'poor';

export interface QuestionBehavior {
  answer: AnswerStyle;
  gate: GateStyle;
  pulse: PulseQuality;
  /** Arousal reached while the question is being asked (0..1). */
  arousalOnAsk: number;
}

const b = (
  answer: AnswerStyle,
  gate: GateStyle,
  pulse: PulseQuality,
  arousalOnAsk: number,
): QuestionBehavior => ({ answer, gate, pulse, arousalOnAsk });

export const SCENARIOS: Record<string, readonly QuestionBehavior[]> = {
  /** Demo flow: warm-up, a hard question with a long silence (cue A), a low-signal answer, a slow settle, a long answer. */
  demo: [
    b('normal', 'normal', 'good', 0.45),
    b('hesitant', 'normal', 'good', 0.8),
    b('normal', 'fast', 'poor', 0.4),
    b('normal', 'slow', 'good', 0.65),
    b('rambling', 'normal', 'good', 0.5),
  ],
  /** Every behavior early, including cue B on question 2. */
  full: [
    b('normal', 'fast', 'good', 0.4),
    b('rambling', 'normal', 'good', 0.5),
    b('hesitant', 'normal', 'good', 0.8),
    b('brief', 'slow', 'poor', 0.6),
    b('normal', 'normal', 'good', 0.5),
  ],
  steady: [b('normal', 'fast', 'good', 0.35)],
  timeout: [b('normal', 'slow', 'good', 0.7), b('normal', 'normal', 'good', 0.5)],
  cueB: [b('rambling', 'normal', 'good', 0.5), b('normal', 'fast', 'good', 0.4)],
};

export function behaviorFor(scenario: string, questionIndex: number): QuestionBehavior {
  const list = SCENARIOS[scenario] ?? SCENARIOS.demo;
  return list[((questionIndex % list.length) + list.length) % list.length];
}

/** Arousal decay time constant during the Gate, per style (ms). */
export const GATE_TAU_MS: Record<GateStyle, number> = {
  fast: 2_500,
  normal: 5_000,
  slow: 60_000,
};
