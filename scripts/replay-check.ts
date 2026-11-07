/**
 * Replay a recorded session (made with `npm run dev -- --record`, then
 * "Save signal recording") through the engine.
 *
 *   npx vite-node scripts/replay-check.ts rec.json                       # same constants as the live session
 *   npx vite-node scripts/replay-check.ts rec.json --config=tuning.json  # what would change with new constants
 *   npx vite-node scripts/replay-check.ts rec.json --write-fixture=real-1  # add to fixtures/replays for npm test
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { QUESTION_BANK } from '../src/content';
import { parseRecording } from '../src/signals/recording';
import { replaySession } from '../src/signals/replaySession';
import { summarize } from '../src/signals/summary';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!file) {
  console.error(
    'usage: npx vite-node scripts/replay-check.ts <recording.json> [--config=tuning.json] [--write-fixture=name]',
  );
  process.exit(2);
}

const recording = parseRecording(readFileSync(file, 'utf8'));
const configFile = opt('config');
const override = configFile ? JSON.parse(readFileSync(configFile, 'utf8')) : null;
const { run, record } = replaySession(recording, QUESTION_BANK, override);
const fmt = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);

console.log(
  `${path.basename(file)}: ${recording.samples.length} samples, ${(recording.durationMs / 1000).toFixed(0)} s, source=${recording.source}`,
);
console.log(`replay reached debrief: ${run.reachedDebrief}${configFile ? ` (with ${configFile})` : ''}`);
for (const q of record.questions) {
  const closed = Object.entries(q.gate.outReasonMs ?? {})
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([r, ms]) => `${r} ${fmt(ms as number)}`)
    .join(', ');
  console.log(
    `  Q${q.index + 1}  ${q.recovery.padEnd(10)} recovery ${fmt(q.recoveryTimeMs).padEnd(7)} in band ${Math.round(q.gate.inBandFraction * 100)}%  pulse cov ${Math.round(q.pulse.coverage * 100)}%  cues ${q.cues.map((c) => c.cue).join('') || '-'}  closed by: ${closed || '-'}`,
  );
}
const measured = record.questions.filter((q) => q.recovery === 'settled' || q.recovery === 'timed out');
const timedOut = measured.filter((q) => q.recovery === 'timed out').length;
console.log(
  `timed out: ${timedOut}/${measured.length}${measured.length && timedOut / measured.length > 1 / 3 ? '  (> 1 in 3: see MORNING_CHECKLIST.md step 2)' : ''}`,
);

const name = opt('write-fixture');
if (name) {
  if (override) {
    console.error('--write-fixture uses the recorded constants; drop --config.');
    process.exit(2);
  }
  const dir = path.resolve(__dirname, '..', 'fixtures', 'replays');
  copyFileSync(file, path.join(dir, `${name}.recording.json`));
  writeFileSync(path.join(dir, `${name}.expected.json`), JSON.stringify(summarize(record), null, 2) + '\n');
  console.log(`wrote fixtures/replays/${name}.recording.json and ${name}.expected.json`);
}
