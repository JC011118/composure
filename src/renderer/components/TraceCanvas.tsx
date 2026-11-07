/**
 * Live breathing trace drawn straight from the engine's live buffer on every
 * animation frame (no React re-render per sample). Spans with
 * sdkConfidenceOk=false, or with no samples, are drawn as gaps.
 *
 * Optional `band` overlay (Gate): two shaded strips where the breath's peaks
 * and troughs should land — center ± [ampLo/2, ampHi/2] around the trace's
 * current resting line.
 */

import { useEffect, useRef } from 'react';
import type { InterviewEngine } from '../../engine/engine';
import type { SignalSample } from '../../engine/types';

export interface BandOverlay {
  center: number | null;
  ampLo: number;
  ampHi: number;
  inBand: boolean;
  /** False when the Gate uses the wide default band. */
  personal: boolean;
}

export interface TraceCanvasProps {
  engine: InterviewEngine;
  height: number;
  windowMs?: number;
  band?: () => BandOverlay | null;
  showTalking?: boolean;
  lineWidth?: number;
  transparent?: boolean;
}

const GAP_MS = 350;

export function TraceCanvas({
  engine,
  height,
  windowMs = 20_000,
  band,
  showTalking = true,
  lineWidth = 2.5,
  transparent = false,
}: TraceCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const bandRef = useRef(band);
  bandRef.current = band;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let yMin = -1;
    let yMax = 1;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!transparent) {
        ctx.fillStyle = 'rgba(10,16,22,0.0)';
        ctx.fillRect(0, 0, w, h);
      }

      const live = engine.getLiveSamples();
      const tEnd = Math.max(engine.now, live.length ? live[live.length - 1].tMs : 0);
      const tStart = tEnd - windowMs;
      const visible: SignalSample[] = [];
      for (let i = live.length - 1; i >= 0; i--) {
        const s = live[i];
        if (s.tMs < tStart) break;
        visible.push(s);
      }
      visible.reverse();
      const x = (t: number) => ((t - tStart) / windowMs) * w;

      // Target scale: around the band if we have one, else the visible range.
      const ov = bandRef.current?.() ?? null;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const s of visible) {
        if (!s.sdkConfidenceOk || s.breathingTrace === undefined) continue;
        if (s.breathingTrace < lo) lo = s.breathingTrace;
        if (s.breathingTrace > hi) hi = s.breathingTrace;
      }
      if (ov && ov.center !== null && Number.isFinite(ov.ampHi) && ov.ampHi > 0) {
        const half = ov.ampHi * 0.95;
        lo = Math.min(ov.center - half, Number.isFinite(lo) ? lo : ov.center - half);
        hi = Math.max(ov.center + half, Number.isFinite(hi) ? hi : ov.center + half);
      }
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        const pad = (hi - lo) * 0.12;
        yMin += (lo - pad - yMin) * 0.08;
        yMax += (hi + pad - yMax) * 0.08;
      }
      const y = (v: number) => h - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * (h - 24) - 12;

      // Talking shading along the bottom.
      if (showTalking) {
        ctx.fillStyle = 'rgba(56,189,248,0.10)';
        let runStart: number | null = null;
        for (let i = 0; i <= visible.length; i++) {
          const s = visible[i];
          const talking = s?.talking === true;
          if (talking && runStart === null) runStart = s.tMs;
          if ((!talking || i === visible.length) && runStart !== null) {
            const endT = s ? s.tMs : tEnd;
            ctx.fillRect(x(runStart), h - 8, Math.max(1, x(endT) - x(runStart)), 8);
            runStart = null;
          }
        }
      }

      // Gaps: unusable signal or missing samples.
      ctx.fillStyle = 'rgba(125,139,154,0.10)';
      let gapStart: number | null = visible.length && visible[0].tMs > tStart + GAP_MS ? tStart : null;
      let prevT = visible.length ? visible[0].tMs : tStart;
      for (const s of visible) {
        const bad = !s.sdkConfidenceOk || s.breathingTrace === undefined || s.tMs - prevT > GAP_MS;
        if (bad && gapStart === null) gapStart = s.tMs - prevT > GAP_MS ? prevT : s.tMs;
        if (!bad && gapStart !== null) {
          ctx.fillRect(x(gapStart), 0, Math.max(1, x(s.tMs) - x(gapStart)), h);
          gapStart = null;
        }
        prevT = s.tMs;
      }
      if (gapStart !== null) ctx.fillRect(x(gapStart), 0, Math.max(1, w - x(gapStart)), h);
      if (!visible.length) {
        ctx.fillStyle = 'rgba(125,139,154,0.55)';
        ctx.font = '13px ui-monospace, Menlo, monospace';
        ctx.fillText('waiting for signal…', 16, h / 2);
      }

      // Band overlay: where this breath's peaks and troughs should land.
      if (ov && ov.center !== null && Number.isFinite(ov.ampHi)) {
        const c = ov.center;
        const accent = ov.inBand;
        // Soft corridor across the whole band envelope.
        ctx.fillStyle = accent ? 'rgba(94,234,212,0.06)' : 'rgba(148,163,184,0.05)';
        ctx.fillRect(0, y(c + ov.ampHi / 2), w, Math.max(1, y(c - ov.ampHi / 2) - y(c + ov.ampHi / 2)));
        // Target zones for peaks (top) and troughs (bottom).
        ctx.fillStyle = accent ? 'rgba(94,234,212,0.22)' : 'rgba(148,163,184,0.18)';
        const zone = (a: number, b: number) => ctx.fillRect(0, y(b), w, Math.max(2, y(a) - y(b)));
        zone(c + ov.ampLo / 2, c + ov.ampHi / 2);
        zone(c - ov.ampHi / 2, c - ov.ampLo / 2);
        ctx.strokeStyle = accent ? 'rgba(94,234,212,0.6)' : 'rgba(148,163,184,0.5)';
        ctx.lineWidth = 1;
        for (const v of [c + ov.ampHi / 2, c + ov.ampLo / 2, c - ov.ampLo / 2, c - ov.ampHi / 2]) {
          ctx.beginPath();
          ctx.moveTo(0, y(v));
          ctx.lineTo(w, y(v));
          ctx.stroke();
        }
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(233,240,246,0.25)';
        ctx.beginPath();
        ctx.moveTo(0, y(c));
        ctx.lineTo(w, y(c));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '12px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = accent ? 'rgba(127,240,221,0.9)' : 'rgba(184,196,208,0.75)';
        ctx.fillText(ov.personal ? 'your seated band' : 'wide default band', w - 12, y(c + ov.ampHi / 2) - 6);
        ctx.textAlign = 'left';
      }

      // The trace.
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = ov?.inBand ? '#7ff0dd' : '#e9f0f6';
      ctx.beginPath();
      let pen = false;
      prevT = Number.NEGATIVE_INFINITY;
      for (const s of visible) {
        const usable = s.sdkConfidenceOk && s.breathingTrace !== undefined;
        if (!usable || s.tMs - prevT > GAP_MS) pen = false;
        if (usable) {
          const px = x(s.tMs);
          const py = y(s.breathingTrace as number);
          if (pen) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          pen = true;
        }
        prevT = s.tMs;
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, windowMs, showTalking, lineWidth, transparent]);

  return <canvas ref={ref} style={{ height, width: '100%', display: 'block' }} />;
}
