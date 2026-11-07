/**
 * Rebuild and replay a recorded session through a fresh engine. Shared by the
 * replay test, the fixture generator, and scripts/replay-check.ts.
 */

import { DEFAULT_CONFIG, mergeConfig, type DeepPartial, type EngineConfig } from '../engine/config';
import { InterviewEngine } from '../engine/engine';
import type { SessionRecord } from '../engine/session';
import type { Question } from '../engine/types';
import { runReplay, type HeadlessRun } from './headless';
import type { SignalRecording } from './recording';
import { ReplaySignalSource } from './ReplaySignalSource';

export interface ReplayOutcome {
  run: HeadlessRun;
  record: SessionRecord;
  config: EngineConfig;
}

export function replaySession(
  recording: SignalRecording,
  bank: readonly Question[],
  override?: DeepPartial<EngineConfig> | null,
): ReplayOutcome {
  const session = recording.session;
  if (!session) throw new Error('This recording has no session timing (record with --record in a session).');
  const questions = session.questionIds.map((id) => {
    const q = bank.find((b) => b.id === id);
    if (!q) throw new Error(`Recording uses question "${id}", which is not in the question bank.`);
    return q;
  });
  const recorded = mergeConfig(DEFAULT_CONFIG, (session.config ?? null) as DeepPartial<EngineConfig> | null);
  const config = mergeConfig(recorded, override ?? null);
  const engine = new InterviewEngine({ questions, mode: 'replay', config });
  const source = new ReplaySignalSource(recording);
  const run = runReplay({ engine, source, actions: session.actions });
  const record = engine.buildRecord({
    id: 'replay',
    createdAt: recording.createdAt || '1970-01-01T00:00:00.000Z',
    appVersion: 'replay',
  });
  return { run, record, config };
}
