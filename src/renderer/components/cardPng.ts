/**
 * Renders the "Recovered in N s" card to a 1200×630 PNG (a share-card size).
 * Numbers only, relative to the user's own baseline; no camera imagery.
 */

import type { QuestionResult } from '../../engine/session';
import { drawSeries } from './Sparkline';

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
        ? 'Already in your band'
        : `Recovered in ${((q.recoveryTimeMs ?? 0) / 1000).toFixed(1)} s`;
    case 'timed out':
      return 'Recovery: timed out';
    case 'paced pause':
      return 'Paced pause';
    default:
      return 'Gate skipped';
  }
}

export function renderRecoveredCard(q: QuestionResult, total: number, dateLabel: string): string {
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
  ctx.fillText(`COMPOSURE · QUESTION ${q.index + 1} OF ${total}`, 64, 82);

  ctx.fillStyle = q.recovery === 'settled' ? '#5eead4' : '#fbbf77';
  ctx.font = '700 92px -apple-system, "Segoe UI", Inter, sans-serif';
  ctx.fillText(cardHeadline(q), 60, 200);

  ctx.fillStyle = '#b8c4d0';
  ctx.font = '26px -apple-system, "Segoe UI", Inter, sans-serif';
  const sub =
    q.recovery === 'settled'
      ? 'Breathing back inside my own seated band, then held there for 5 s.'
      : q.recovery === 'timed out'
        ? 'The Gate opened at its 45 s limit.'
        : 'No measurement for this pause.';
  ctx.fillText(sub, 64, 250);

  ctx.fillStyle = '#e9f0f6';
  ctx.font = '500 30px -apple-system, "Segoe UI", Inter, sans-serif';
  wrap(ctx, `“${q.text}”`, W - 128, 2).forEach((line, i) => ctx.fillText(line, 64, 318 + i * 40));

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
  if (q.pulse.shown && q.pulse.deltaBpm !== null) {
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
