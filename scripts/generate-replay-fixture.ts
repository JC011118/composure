/**
 * Regenerates fixtures/replays/sim-demo-seed7.*.json from a simulated session:
 *   - a signal recording with session timing (questions, config, actions), and
 *   - the expected debrief summary, computed by replaying that recording.
 *
 * tests/replay.test.ts replays every fixture and checks it reproduces its
 * expected summary. Run with `npm run fixtures:generate` after deliberately
 * changing engine behavior.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { InterviewEngine } from '../src/engine/engine';
import { selectQuestions } from '../src/engine/questions';
import { QUESTION_BANK } from '../src/content';
import { SimulatedSignalSource } from '../src/signals/SimulatedSignalSource';
import { parseRecording, recordToJson } from '../src/signals/recording';
import { runHeadless } from '../src/signals/headless';
import { replaySession } from '../src/signals/replaySession';
import { summarize } from '../src/signals/summary';

const FIXTURE = { seed: 7, scenario: 'demo', questions: 3 };

const questions = selectQuestions(QUESTION_BANK, FIXTURE.questions, FIXTURE.seed);
const source = new SimulatedSignalSource({ seed: FIXTURE.seed, scenario: FIXTURE.scenario });
const engine = new InterviewEngine({ questions, mode: 'simulated' });
const tap = recordToJson(source);
tap.setSession(
  questions.map((q) => q.id),
  DEFAULT_CONFIG,
);
const run = runHeadless({ engine, source, onAction: (a, t, id) => tap.mark(a, t, id) });
tap.stop();
if (!run.reachedDebrief) throw new Error('simulated session did not reach the debrief');

const meta = { id: 'fixture', createdAt: '2026-11-07T00:00:00.000Z', appVersion: 'fixture' };
const live = summarize(engine.buildRecord(meta));
const recordingJson = tap.toJson(
  meta.createdAt,
  `simulator seed=${FIXTURE.seed} scenario=${FIXTURE.scenario}`,
);
const replay = replaySession(parseRecording(recordingJson), QUESTION_BANK);
if (!replay.run.reachedDebrief) throw new Error('replay did not reach the debrief');
const expected = summarize(replay.record);

const dir = path.resolve(__dirname, '..', 'fixtures', 'replays');
writeFileSync(path.join(dir, 'sim-demo-seed7.recording.json'), recordingJson);
writeFileSync(path.join(dir, 'sim-demo-seed7.expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log(
  `wrote ${tap.sampleCount} samples, ${expected.questions.length} questions, ended at ${run.endMs} ms`,
);
console.log(`live vs replay summaries identical: ${JSON.stringify(live) === JSON.stringify(expected)}`);
