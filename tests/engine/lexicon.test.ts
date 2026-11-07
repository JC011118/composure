import { describe, expect, it } from 'vitest';
import {
  CORE_TERMS,
  LABEL_TERMS,
  decodeTerm,
  findBannedTerms,
  redactBannedTerms,
  REDACTION,
} from '../../src/engine/lexicon';

// Build test strings from the decoded lists so this file stays grep-clean.
const core0 = CORE_TERMS[0];
const label0 = LABEL_TERMS[0];

describe('lexicon', () => {
  it('decodes the five contest terms', () => {
    expect(CORE_TERMS).toHaveLength(5);
    expect(decodeTerm('bcd')).toBe('abc');
  });

  it('finds core terms as substrings, case-insensitively', () => {
    expect(findBannedTerms(`Some ${core0.toUpperCase()}ful thing`)).toHaveLength(1);
  });

  it('finds feelings labels only as whole words', () => {
    expect(findBannedTerms(`you seem ${label0}`)).toHaveLength(1);
    expect(findBannedTerms(`${label0}x is not a word`)).toHaveLength(0);
  });

  it('passes neutral baseline-relative copy', () => {
    expect(findBannedTerms('Breathing rate 2.1 br/min above your seated baseline.')).toEqual([]);
    expect(findBannedTerms('Recovered in 12 s. Pulse +6 bpm vs talking baseline.')).toEqual([]);
  });

  it('redacts text we do not author', () => {
    const out = redactBannedTerms(`A ${core0} reading and a ${label0} moment.`);
    expect(out).toBe(`A ${REDACTION} reading and a ${REDACTION} moment.`);
    expect(findBannedTerms(out)).toEqual([]);
  });
});
