/**
 * Deterministic, timer-free run of the engine against a steppable source
 * (simulator or replay). Used by the end-to-end tests and the replay fixture
 * generator. Speech is "spoken" instantly with an estimated duration.
 */

import type { InterviewEngine } from '../engine/engine';
import type { EngineEvent } from '../engine/types';
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
        engine.begin(t);
        begun = true;
      }
      source.stepTo(t);
      engine.tick(t);
      for (let i = pendingSpeech.length - 1; i >= 0; i--) {
        if (pendingSpeech[i].at <= t) {
          const [{ id }] = pendingSpeech.splice(i, 1);
          engine.speechEnded(id, t);
        }
      }
      if (opts.autoContinue) engine.continueAfterGate(t);
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
