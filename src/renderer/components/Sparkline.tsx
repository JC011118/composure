/**
 * Static chart for saved series. `null` points are gaps: the line breaks and
 * the span is shaded; no value is ever interpolated across a gap.
 */

import { useEffect, useRef } from 'react';
import type { SeriesPoint } from '../../engine/metrics';
import type { TalkSegment } from '../../engine/types';

export interface SparklineProps {
  series: SeriesPoint[];
  height: number;
  color?: string;
  talk?: TalkSegment[];
  marks?: { atMs: number; label: string }[];
  /** Optional horizontal reference line (e.g. a baseline mean). */
  reference?: number | null;
  unit?: string;
  totalMs?: number;
}

export function drawSeries(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  series: SeriesPoint[],
  opts: {
    color: string;
    talk?: TalkSegment[];
    marks?: { atMs: number; label: string }[];
    reference?: number | null;
    totalMs?: number;
    lineWidth?: number;
    labelFont?: string;
  },
): void {
  const total = opts.totalMs ?? (series.length ? series[series.length - 1][0] : 1);
  const x = (t: number) => (t / Math.max(1, total)) * w;
  const vals = series.map((p) => p[1]).filter((v): v is number => v !== null);
  if (opts.reference !== null && opts.reference !== undefined) vals.push(opts.reference);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-6) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.12;
  const y = (v: number) => h - 6 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (h - 12);

  for (const seg of opts.talk ?? []) {
    ctx.fillStyle = 'rgba(56,189,248,0.10)';
    ctx.fillRect(x(seg.startMs), 0, Math.max(1, x(seg.endMs) - x(seg.startMs)), h);
  }

  // Gap shading.
  ctx.fillStyle = 'rgba(125,139,154,0.16)';
  const step = series.length > 1 ? series[1][0] - series[0][0] : 1000;
  let gapStart: number | null = null;
  for (const [t, v] of series) {
    if (v === null && gapStart === null) gapStart = t;
    if (v !== null && gapStart !== null) {
      ctx.fillRect(x(gapStart), 0, Math.max(1, x(t) - x(gapStart)), h);
      gapStart = null;
    }
  }
  if (gapStart !== null) ctx.fillRect(x(gapStart), 0, Math.max(1, x(total + step) - x(gapStart)), h);

  if (opts.reference !== null && opts.reference !== undefined) {
    ctx.strokeStyle = 'rgba(233,240,246,0.35)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(opts.reference));
    ctx.lineTo(w, y(opts.reference));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = opts.color;
  ctx.lineWidth = opts.lineWidth ?? 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (const [t, v] of series) {
    if (v === null) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(x(t), y(v));
    else ctx.moveTo(x(t), y(v));
    pen = true;
  }
  ctx.stroke();

  ctx.font = opts.labelFont ?? '11px ui-monospace, Menlo, monospace';
  for (const m of opts.marks ?? []) {
    ctx.strokeStyle = 'rgba(233,240,246,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(m.atMs), 0);
    ctx.lineTo(x(m.atMs), h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(233,240,246,0.55)';
    ctx.fillText(m.label, x(m.atMs) + 4, 12);
  }
}

export function Sparkline({
  series,
  height,
  color = '#e9f0f6',
  talk,
  marks,
  reference,
  totalMs,
}: SparklineProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    drawSeries(ctx, w, height, series, { color, talk, marks, reference, totalMs });
  }, [series, height, color, talk, marks, reference, totalMs]);
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />;
}
