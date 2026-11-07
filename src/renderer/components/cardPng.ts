/**
 * Renders the "Recovered in N s" card to a 1200×630 PNG (a share-card size).
 * Numbers only, relative to the user's own baseline; no camera imagery.
 */

import type { QuestionResult } from '../../engine/session';
import type { SignalMode } from '../../engine/types';
import { drawSeries } from './Sparkline';
import { provenanceLabel } from './provenance';

const W = 1200;
const H = 630;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

export function cardHeadline(q: QuestionResult): string {
  switch (q.recovery) {
    case 'settled':
      return q.recoveryTimeMs !== null && q.recoveryTimeMs < 500
        ? 'Already in the band'
        : `Recovered in ${((q.recoveryTimeMs ?? 0) / 1000).toFixed(1)} s`;
    case 'timed out':
      return 'Recovery: timed out';
    case 'paced pause':
      return 'Paced pause';
    default:
      return 'Gate skipped';
  }
}

export function renderRecoveredCard(
  q: QuestionResult,
  total: number,
  dateLabel: string,
  gate: { holdMs: number; timeoutMs: number },
  source: { mode: SignalMode; replayOf?: SignalMode },
): string {
  const provenance = provenanceLabel(source.mode, source.replayOf);
  const personal = q.gate.personalBand !== false;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b141c');
  bg.addColorStop(1, '#071016');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, H * 0.2, 10, W * 0.78, H * 0.2, 520);
  glow.addColorStop(0, 'rgba(94,234,212,0.18)');
  glow.addColorStop(1, 'rgba(94,234,212,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#7d8b9a';
  ctx.font = '600 22px -apple-system, "Segoe UI", Inter, sans-serif';
  const header = `COMPOSURE · QUESTION ${q.index + 1} OF ${total}`;
  ctx.fillText(header, 64, 82);
  const headerEnd = 64 + ctx.measureText(header).width + 24;
  if (provenance) {
    // Never let a simulated or replayed card pass as a live measurement.
    // One line if it fits beside the header, else two lines (split at " · "), shrinking if needed.
    let size = 22;
    let lines = [provenance];
    const fits = (ls: string[], px: number) => {
      ctx.font = `700 ${px}px ui-monospace, Menlo, monospace`;
      return Math.max(...ls.map((l) => ctx.measureText(l).width)) + 24 <= W - 64 - headerEnd;
    };
    if (!fits(lines, size)) {
      const parts = provenance.split(' · ');
      lines = parts.length > 1 ? [parts[0], parts.slice(1).join(' · ')] : lines;
      while (!fits(lines, size) && size > 12) size--;
    }
    ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const lineH = size + 6;
    ctx.fillStyle = 'rgba(251,191,119,0.16)';
    ctx.fillRect(W - 64 - tw - 24, 52, tw + 24, 18 + lineH * lines.length);
    ctx.fillStyle = '#fbbf77';
    ctx.textAlign = 'right';
    lines.forEach((l, i) => ctx.fillText(l, W - 64 - 12, 52 + 8 + size + i * lineH));
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = q.recovery === 'settled' ? '#5eead4' : '#fbbf77';
  ctx.font = '700 92px -apple-system, "Segoe UI", Inter, sans-serif';
  ctx.fillText(cardHeadline(q), 60, 200);

  ctx.fillStyle = '#b8c4d0';
  ctx.font = '26px -apple-system, "Segoe UI", Inter, sans-serif';
  const sub =
    q.recovery === 'settled'
      ? `Breathing back inside ${personal ? 'my own seated band' : 'a wide default band (not a personal baseline)'}, then held there for ${(gate.holdMs / 1000).toFixed(0)} s.`
      : q.recovery === 'timed out'
        ? `The Gate opened at its ${(gate.timeoutMs / 1000).toFixed(0)} s limit.`
        : 'No measurement for this pause.';
  const subLines = wrap(ctx, sub, W - 128, 2);
  subLines.forEach((line, i) => ctx.fillText(line, 64, 250 + i * 32));
  const shift = (subLines.length - 1) * 32;

  ctx.fillStyle = '#e9f0f6';
  ctx.font = '500 30px -apple-system, "Segoe UI", Inter, sans-serif';
  wrap(ctx, `“${q.text}”`, W - 128, shift > 0 ? 1 : 2).forEach((line, i) =>
    ctx.fillText(line, 64, 318 + shift + i * 40),
  );

  // Gate-period breathing trace.
  const gateRel = q.series.marks.gateMs;
  const gateSeries = q.series.trace
    .filter(([t]) => t >= gateRel)
    .map(([t, v]) => [t - gateRel, v] as [number, number | null]);
  ctx.save();
  ctx.translate(64, 410);
  ctx.fillStyle = 'rgba(19,27,36,0.9)';
  ctx.fillRect(0, 0, W - 128, 140);
  drawSeries(ctx, W - 128, 140, gateSeries, { color: '#7ff0dd', lineWidth: 3 });
  ctx.restore();

  ctx.fillStyle = '#7d8b9a';
  ctx.font = '20px ui-monospace, Menlo, monospace';
  const extras: string[] = [];
  if (!provenance && q.pulse.shown && q.pulse.deltaBpm !== null) {
    extras.push(
      `pulse ${q.pulse.deltaBpm >= 0 ? '+' : '−'}${Math.abs(q.pulse.deltaBpm).toFixed(0)} bpm vs talking baseline`,
    );
  }
  extras.push(`talk ${(q.talkTimeMs / 1000).toFixed(0)} s · pauses ${q.pauseCount}`);
  ctx.fillText(extras.join('   ·   '), 64, 592);
  ctx.textAlign = 'right';
  ctx.fillText(dateLabel, W - 64, 592);

  return canvas.toDataURL('image/png');
}
