import { describe, expect, it } from 'vitest';
import { findBannedTerms } from '../src/engine/lexicon';
import { listFiles, read, rootTextFiles } from './repoFiles';

/**
 * Contest rule: no feelings labels or diagnosis-adjacent words anywhere in
 * UI strings, logs, or docs. The list lives (encoded) in src/engine/lexicon.ts.
 */
describe('banned words', () => {
  const files = [
    ...listFiles('src'),
    ...listFiles('docs'),
    ...listFiles('tests'),
    ...listFiles('scripts'),
    ...listFiles('fixtures'),
    ...listFiles('build'),
    ...rootTextFiles(),
  ];

  it('scans a non-trivial set of files', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.startsWith('src'))).toBe(true);
  });

  it.each(files)('%s contains no banned terms', (file) => {
    const text = read(file);
    const hits = findBannedTerms(text).map((h) => {
      const line = text.slice(0, h.index).split('\n').length;
      return `${file}:${line} (${h.list} list, ${h.length} chars)`;
    });
    expect(hits).toEqual([]);
  });
});
