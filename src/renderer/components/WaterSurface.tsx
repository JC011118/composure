/**
 * The Gate's water surface. Ripple energy follows how far the breath is from
 * the user's own seated band; as the trace settles the ripples die down and
 * the surface turns to glass. The water line also rises and falls gently with
 * the breath itself.
 */

import { useEffect, useRef } from 'react';

export interface WaterState {
  /** 0 = glassy, 1 = rough. */
  intensity: number;
  /** Breath position, roughly -1 (exhaled) .. 1 (inhaled); null when unknown. */
  breath: number | null;
  /** Fully settled: freeze to glass. */
  still: boolean;
}

export interface WaterSurfaceProps {
  height: number;
  state: () => WaterState;
  /** Resting water line as a fraction of the height. */
  surface?: number;
}

export function WaterSurface({ height, state, surface = 0.42 }: WaterSurfaceProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let energy = 0.6;
    let breath = 0;
    let t0: number | null = null;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (t0 === null) t0 = now;
      const t = (now - t0) / 1000;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const s = stateRef.current();
      const target = s.still ? 0 : Math.max(0, Math.min(1, s.intensity));
      energy += (target - energy) * (target < energy ? 0.025 : 0.06);
      breath += ((s.breath ?? 0) - breath) * 0.08;

      const surfaceY = h * surface - breath * h * 0.035;

      // Sky.
      const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
      sky.addColorStop(0, '#08121b');
      sky.addColorStop(1, '#0c1c28');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Light source above the water.
      const glow = ctx.createRadialGradient(w * 0.5, surfaceY * 0.35, 4, w * 0.5, surfaceY * 0.35, h * 0.5);
      glow.addColorStop(0, 'rgba(160, 235, 225, 0.22)');
      glow.addColorStop(1, 'rgba(160, 235, 225, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Water body with a wavy surface.
      const amp = 2 + energy * 14;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w; px += 6) {
        const u = px / w;
        const yy =
          surfaceY +
          amp *
            (0.55 * Math.sin(u * 9 + t * 1.6) +
              0.3 * Math.sin(u * 23 - t * 2.3 + 1.2) +
              0.15 * Math.sin(u * 51 + t * 3.1 + 0.4));
        ctx.lineTo(px, yy);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const water = ctx.createLinearGradient(0, surfaceY - amp, 0, h);
      water.addColorStop(0, '#12384a');
      water.addColorStop(0.35, '#0b2635');
      water.addColorStop(1, '#050d14');
      ctx.fillStyle = water;
      ctx.fill();

      // Reflection column: broken when rough, a clean column when glassy.
      const colW = w * 0.06;
      for (let k = 0; k < 26; k++) {
        const yy = surfaceY + 10 + k * ((h - surfaceY - 20) / 26);
        const jitter = energy * 22 * Math.sin(t * 2.2 + k * 1.7);
        const width = colW * (1 - k / 34) * (1 + energy * 0.8 * Math.sin(t * 3 + k));
        const alpha = (0.2 - k * 0.006) * (1 - energy * 0.5);
        if (alpha <= 0) continue;
        ctx.fillStyle = `rgba(170, 240, 230, ${alpha.toFixed(3)})`;
        ctx.fillRect(w * 0.5 - width / 2 + jitter, yy, width, 2 + (1 - energy) * 6);
      }

      // Rings spreading from the center; they fade out as energy drops.
      const maxR = w * 0.55;
      for (let k = 0; k < 5; k++) {
        const r = ((t * 70 + k * (maxR / 5)) % maxR) + 6;
        const alpha = (1 - r / maxR) * energy * 0.55;
        if (alpha < 0.01) continue;
        ctx.strokeStyle = `rgba(150, 225, 220, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(w * 0.5, surfaceY + 28 + r * 0.12, r, r * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Surface highlight line.
      ctx.strokeStyle = `rgba(200, 250, 242, ${(0.18 + (1 - energy) * 0.25).toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 6) {
        const u = px / w;
        const yy =
          surfaceY + amp * (0.55 * Math.sin(u * 9 + t * 1.6) + 0.3 * Math.sin(u * 23 - t * 2.3 + 1.2));
        if (px === 0) ctx.moveTo(px, yy);
        else ctx.lineTo(px, yy);
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [surface]);

  return <canvas ref={ref} className="water" style={{ height, width: '100%', display: 'block' }} />;
}
