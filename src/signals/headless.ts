/**
 * Deterministic, timer-free run of the engine against a steppable source
 * (simulator or replay). Used by the end-to-end tests and the replay fixture
 * generator. Speech is "spoken" instantly with an estimated duration.
 */

import type { InterviewEngine } from '../engine/engine';
import type { EngineEvent } from '../engine/types';
import type { SessionAction } from './recording';
import type { ReplaySignalSource } from './ReplaySignalSource';
import type { SignalSource } from './SignalSource';

export interface SteppableSource extends SignalSource {
  stepTo(tMs: number): void;
}

export interface HeadlessOptions {
  engine: InterviewEngine;
  source: SteppableSource;
  /** Step size of the driving loop. */
  stepMs?: number;
  /** Stop after this much simulated time even if the debrief was not reached. */
  maxMs?: number;
  /** Simulated speech duration for an utterance. */
  speechMs?: (text: string) => number;
  /** Skip the post-unlock card dwell (faster runs). */
  autoContinue?: boolean;
  /** When to give consent. */
  beginAtMs?: number;
  /** Called for every action applied to the engine (feed a RecordingTap's mark()). */
  onAction?: (action: SessionAction, tMs: number, speechId?: number) => void;
}

export interface HeadlessRun {
  events: EngineEvent[];
  endMs: number;
  reachedDebrief: boolean;
}

export function defaultSpeechMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return 600 + words * 330;
}

export function runHeadless(opts: HeadlessOptions): HeadlessRun {
  const { engine, source } = opts;
  const stepMs = opts.stepMs ?? 100;
  const maxMs = opts.maxMs ?? 30 * 60_000;
  const speechMs = opts.speechMs ?? defaultSpeechMs;
  const events: EngineEvent[] = [];
  const pendingSpeech: { id: number; at: number }[] = [];

  const offEngine = engine.on((e) => {
    events.push(e);
    source.observeEngine?.(e);
    if (e.type === 'speak') pendingSpeech.push({ id: e.id, at: e.tMs + speechMs(e.text) });
  });
  const offSample = source.onSample((s) => engine.ingest(s));
  const offStatus = source.onStatus((s) => engine.ingestStatus(s));

  const beginAt = opts.beginAtMs ?? 0;
  let t = 0;
  let begun = false;
  try {
    while (t <= maxMs) {
      if (!begun && t >= beginAt) {
        opts.onAction?.('begin', t);
        engine.begin(t);
        begun = true;
      }
      source.stepTo(t);
      engine.tick(t);
      for (let i = pendingSpeech.length - 1; i >= 0; i--) {
        if (pendingSpeech[i].at <= t) {
          const [{ id }] = pendingSpeech.splice(i, 1);
          opts.onAction?.('speechEnded', t, id);
          engine.speechEnded(id, t);
        }
      }
      if (opts.autoContinue && engine.snapshotNow().gate?.result) {
        opts.onAction?.('continueAfterGate', t);
        engine.continueAfterGate(t);
      }
      if (engine.currentPhase === 'debrief') break;
      t += stepMs;
    }
  } finally {
    offEngine();
    offSample();
    offStatus();
  }
  return { events, endMs: t, reachedDebrief: engine.currentPhase === 'debrief' };
}

export interface ReplayRunOptions {
  engine: InterviewEngine;
  source: ReplaySignalSource;
  actions: { action: SessionAction; tMs: number; afterSamples: number; speechId?: number }[];
  /** How long to keep the clock running after the last sample (lets a final Gate time out). */
  tailMs?: number;
}

/**
 * Exact replay of a recorded session: samples are fed one at a time and each
 * recorded action is applied after the same number of samples it followed
 * live, at its recorded time (re-based like the samples).
 */
export function runReplay(opts: ReplayRunOptions): HeadlessRun {
  const { engine, source } = opts;
  const events: EngineEvent[] = [];
  const base = source.timeBaseMs;
  const actions = [...opts.actions].sort((a, b) => a.afterSamples - b.afterSamples);
  const offEngine = engine.on((e) => events.push(e));
  const offSample = source.onSample((s) => engine.ingest(s));
  const offStatus = source.onStatus((s) => engine.ingestStatus(s));
  let ai = 0;
  let lastT = 0;
  const apply = (a: (typeof actions)[number]) => {
    const t = a.tMs - base;
    lastT = Math.max(lastT, t);
    switch (a.action) {
      case 'begin':
        engine.begin(t);
        break;
      case 'speechEnded':
        if (a.speechId !== undefined) engine.speechEnded(a.speechId, t);
        break;
      case 'manualEndAnswer':
        engine.manualEndAnswer(t);
        break;
      case 'continueAfterGate':
        engine.continueAfterGate(t);
        break;
      case 'skipGate':
        engine.skipGate(t);
        break;
      case 'endSession':
        engine.endSession(t);
        break;
    }
  };
  try {
    for (;;) {
      while (ai < actions.length && actions[ai].afterSamples <= source.emittedCount) apply(actions[ai++]);
      if (!source.stepOne()) break;
      lastT = Math.max(lastT, source.now());
      engine.tick(source.now());
    }
    while (ai < actions.length) apply(actions[ai++]);
    const tail = opts.tailMs ?? 120_000;
    for (let t = lastT; t <= lastT + tail && engine.currentPhase !== 'debrief'; t += 100) engine.tick(t);
  } finally {
    offEngine();
    offSample();
    offStatus();
  }
  return { events, endMs: engine.now, reachedDebrief: engine.currentPhase === 'debrief' };
}
