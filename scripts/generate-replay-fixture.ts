/**
 * Regenerates fixtures/replays/sim-demo-seed7.*.json:
 *   - a signal recording captured from a simulated session (normalized
 *     samples + statuses only), and
 *   - the expected debrief summary for that session.
 *
 * tests/replay.test.ts replays the recording through a fresh engine and checks
 * it reproduces the same debrief. Run with `npm run fixtures:generate` after
 * deliberately changing engine behavior.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { InterviewEngine } from '../src/engine/engine';
import { selectQuestions } from '../src/engine/questions';
import { QUESTION_BANK } from '../src/content';
import { SimulatedSignalSource } from '../src/signals/SimulatedSignalSource';
import { parseRecording, recordToJson } from '../src/signals/recording';
import { ReplaySignalSource } from '../src/signals/ReplaySignalSource';
import { runHeadless } from '../src/signals/headless';
import { summarize } from '../src/signals/summary';

export const FIXTURE = { seed: 7, scenario: 'demo', questions: 3 };

const questions = selectQuestions(QUESTION_BANK, FIXTURE.questions, FIXTURE.seed);
const source = new SimulatedSignalSource({ seed: FIXTURE.seed, scenario: FIXTURE.scenario });
const engine = new InterviewEngine({ questions, mode: 'simulated' });
const tap = recordToJson(source);
const run = runHeadless({ engine, source, autoContinue: false });
tap.stop();
if (!run.reachedDebrief) throw new Error('simulated session did not reach the debrief');

const meta = { id: 'fixture', createdAt: '2026-11-07T00:00:00.000Z', appVersion: 'fixture' };
const live = summarize(engine.buildRecord(meta));
const recordingJson = tap.toJson(
  meta.createdAt,
  `simulator seed=${FIXTURE.seed} scenario=${FIXTURE.scenario}`,
);

// The expected debrief is what the engine produces from the recording itself
// (the recording stores rounded values, so a live run can differ by a frame).
const replayEngine = new InterviewEngine({ questions, mode: 'replay' });
const replay = runHeadless({
  engine: replayEngine,
  source: new ReplaySignalSource(parseRecording(recordingJson)),
});
if (!replay.reachedDebrief) throw new Error('replay did not reach the debrief');
const expected = summarize(replayEngine.buildRecord(meta));

const dir = path.resolve(__dirname, '..', 'fixtures', 'replays');
writeFileSync(path.join(dir, 'sim-demo-seed7.recording.json'), recordingJson);
writeFileSync(path.join(dir, 'sim-demo-seed7.expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log(
  `wrote ${tap.sampleCount} samples, ${expected.questions.length} questions, ended at ${run.endMs} ms`,
);
console.log(`live vs replay summaries identical: ${JSON.stringify(live) === JSON.stringify(expected)}`);
