/**
 * Speech timing from the SDK's frame-level `face.talking.detected` flag.
 *
 * TalkDebouncer turns the flickery raw flag into clean talk segments with
 * back-dated edges (a segment starts at the first raw `true` of the run that
 * survived the on-debounce, and ends at the first raw `false` of the run that
 * survived the off-debounce).
 *
 * AnswerTracker applies the Listening rules for one question:
 *   - the answer starts at the first debounced talking=true
 *   - end-detection arms once the answer has run `minAnswerMs`
 *   - the answer ends after `endSilenceMs` of continuous silence following
 *     speech, counted from max(last speech end, the moment end-detection
 *     armed, end-clock floor) — silence before arming is not "detected"
 *   - cue A moves the end-clock floor so "Take your time." is never followed
 *     immediately by the answer being closed
 *   - hard caps: `maxAnswerMs`, and `noAnswerTimeoutMs` when no speech at all
 *
 * Pure module.
 */

import type { ListeningConfig } from './config';
import type { AnswerEndReason, CueEvent, TalkSegment } from './types';

export interface TalkEdge {
  talking: boolean;
  /** Back-dated time of the edge. */
  edgeMs: number;
}

export class TalkDebouncer {
  private _talking = false;
  private rawTrueSince: number | null = null;
  private rawFalseSince: number | null = null;

  constructor(
    private readonly onMs: number,
    private readonly offMs: number,
  ) {}

  get talking(): boolean {
    return this._talking;
  }

  /** The latest raw flag (true only while the SDK currently reports talking). */
  get rawTalking(): boolean {
    return this.rawTrueSince !== null;
  }

  /** Feed one raw sample; returns an edge when the debounced state flips. */
  push(tMs: number, raw: boolean | undefined): TalkEdge | null {
    const r = raw === true;
    if (r) {
      if (this.rawTrueSince === null) this.rawTrueSince = tMs;
      this.rawFalseSince = null;
      if (!this._talking && tMs - this.rawTrueSince >= this.onMs) {
        this._talking = true;
        return { talking: true, edgeMs: this.rawTrueSince };
      }
    } else {
      if (this.rawFalseSince === null) this.rawFalseSince = tMs;
      this.rawTrueSince = null;
      if (this._talking && tMs - this.rawFalseSince >= this.offMs) {
        this._talking = false;
        return { talking: false, edgeMs: this.rawFalseSince };
      }
    }
    return null;
  }
}

export interface AnswerEnd {
  tMs: number;
  reason: AnswerEndReason;
}

export class AnswerTracker {
  answerStartMs: number | null = null;
  readonly segments: TalkSegment[] = [];
  private openSegStart: number | null = null;
  lastTalkEndMs: number | null = null;
  endClockFloorMs = Number.NEGATIVE_INFINITY;
  readonly cues: CueEvent[] = [];
  ended: AnswerEnd | null = null;

  constructor(
    private readonly cfg: ListeningConfig,
    readonly listenStartMs: number,
    talkingAtStart: boolean,
  ) {
    if (talkingAtStart) {
      this.answerStartMs = listenStartMs;
      this.openSegStart = listenStartMs;
    }
  }

  get talking(): boolean {
    return this.openSegStart !== null;
  }

  get answerStarted(): boolean {
    return this.answerStartMs !== null;
  }

  hasCue(kind: 'A' | 'B'): boolean {
    return this.cues.some((c) => c.cue === kind);
  }

  onEdge(edge: TalkEdge): void {
    if (this.ended) return;
    const at = Math.max(edge.edgeMs, this.listenStartMs);
    if (edge.talking) {
      if (this.openSegStart !== null) return;
      this.openSegStart = at;
      if (this.answerStartMs === null) this.answerStartMs = at;
    } else {
      if (this.openSegStart === null) return;
      if (at > this.openSegStart) {
        this.segments.push({ startMs: this.openSegStart, endMs: at });
        this.lastTalkEndMs = at;
      } else if (this.segments.length === 0) {
        // Speech that really ended before Listening began: not an answer.
        this.answerStartMs = null;
      } else {
        this.lastTalkEndMs = at;
      }
      this.openSegStart = null;
    }
  }

  /** Silence since the last speech ended (null if talking or no speech yet). */
  silenceMs(tMs: number): number | null {
    if (this.openSegStart !== null || this.lastTalkEndMs === null) return null;
    return tMs - this.lastTalkEndMs;
  }

  answerElapsedMs(tMs: number): number | null {
    return this.answerStartMs === null ? null : tMs - this.answerStartMs;
  }

  armed(tMs: number): boolean {
    return this.answerStartMs !== null && tMs - this.answerStartMs >= this.cfg.minAnswerMs;
  }

  /** Record a cue; end-of-answer silence will not be counted before `floorMs`. */
  recordCue(cue: CueEvent, floorMs: number): void {
    this.cues.push(cue);
    this.endClockFloorMs = Math.max(this.endClockFloorMs, floorMs);
  }

  /** Check end conditions at time t. */
  check(tMs: number): AnswerEnd | null {
    if (this.ended) return this.ended;
    if (this.answerStartMs === null) {
      if (tMs - this.listenStartMs >= this.cfg.noAnswerTimeoutMs) return this.end(tMs, 'noAnswer');
      return null;
    }
    if (tMs - this.answerStartMs >= this.cfg.maxAnswerMs) return this.end(tMs, 'maxLength');
    if (this.openSegStart === null && this.lastTalkEndMs !== null && this.armed(tMs)) {
      // Silence only counts once end-detection is armed (and after any cue grace).
      const armMs = this.answerStartMs + this.cfg.minAnswerMs;
      const ref = Math.max(this.lastTalkEndMs, armMs, this.endClockFloorMs);
      if (tMs - ref >= this.cfg.endSilenceMs) return this.end(tMs, 'silence');
    }
    return null;
  }

  end(tMs: number, reason: AnswerEndReason): AnswerEnd {
    if (this.ended) return this.ended;
    if (this.openSegStart !== null) {
      if (tMs > this.openSegStart) this.segments.push({ startMs: this.openSegStart, endMs: tMs });
      this.lastTalkEndMs = tMs;
      this.openSegStart = null;
    }
    this.ended = { tMs, reason };
    return this.ended;
  }

  /** End of the spoken answer (last speech end), or null if nothing was said. */
  get answerEndMs(): number | null {
    return this.answerStartMs === null ? null : this.lastTalkEndMs;
  }

  talkTimeMs(): number {
    return this.segments.reduce((s, seg) => s + (seg.endMs - seg.startMs), 0);
  }

  /** Silent gaps between consecutive talk segments that are at least `pauseMinMs`. */
  pauses(): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.segments.length; i++) {
      const gap = this.segments[i].startMs - this.segments[i - 1].endMs;
      if (gap >= this.cfg.pauseMinMs) out.push(gap);
    }
    return out;
  }
}
