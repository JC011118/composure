/**
 * Builds the on-demand LLM Insights prompt from a finished session. Only
 * baseline-relative numbers go in; the instructions ask for numbers only and
 * forbid feelings labels and medical advice. Replies are still passed through
 * redactBannedTerms before display.
 *
 * Pure module.
 */

import type { SessionRecord } from './session';

const fmtS = (ms: number | null): string => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const signed = (x: number, digits: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;

export function buildInsightPrompt(rec: SessionRecord): string {
  const lines: string[] = [];
  lines.push(
    'I just finished a practice interview session. Summarize how my measured signals changed across the questions, ' +
      'relative to my own baselines, in at most four short sentences. Use only the numbers below and the buffered vitals. ' +
      'Do not label feelings or mental states, do not speculate about causes, and do not give medical advice.',
  );
  const sb = rec.baselines.seated?.breathingRate?.mean;
  const tp = rec.baselines.talking?.pulse?.mean;
  if (sb !== undefined) lines.push(`Seated baseline breathing rate: ${sb.toFixed(1)} breaths/min.`);
  if (tp !== undefined) lines.push(`Talking baseline pulse: ${tp.toFixed(0)} bpm.`);
  for (const q of rec.questions) {
    const parts = [
      `Q${q.index + 1} (${q.tag})`,
      `time to first word ${fmtS(q.timeToFirstWordMs)}`,
      `talk time ${fmtS(q.talkTimeMs)}`,
      `pauses ${q.pauseCount}`,
      q.recovery === 'settled'
        ? `breathing back in seated band after ${fmtS(q.recoveryTimeMs)}`
        : `recovery: ${q.recovery}`,
    ];
    if (q.pulse.shown && q.pulse.deltaBpm !== null)
      parts.push(`pulse ${signed(q.pulse.deltaBpm, 0)} bpm vs talking baseline`);
    if (q.breathing.shown && q.breathing.deltaBrPerMin !== null) {
      parts.push(
        `breathing rate in silences ${signed(q.breathing.deltaBrPerMin, 1)} br/min vs seated baseline`,
      );
    }
    lines.push(parts.join(', ') + '.');
  }
  return lines.join('\n').slice(0, 4000);
}
