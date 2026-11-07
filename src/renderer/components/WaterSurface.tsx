/**
 * The Gate's water surface.
 *
 * Every measured breath drops a ripple whose size follows how far that breath
 * was from the user's own seated band; settled breaths barely disturb the
 * water. Background swell follows the same distance, smoothed. As the in-band
 * hold builds, the surface turns to glass and the light's reflection sharpens.
 * The water line also rises and falls gently with the breath itself.
 */

import { useEffect, useRef } from 'react';

export interface WaterState {
  /** 0 = glassy, 1 = rough. */
  intensity: number;
  /** Breath position, roughly -1 (exhaled) .. 1 (inhaled); null when unknown. */
  breath: number | null;
  /** Fully settled: freeze to glass. */
  still: boolean;
  /** Changes whenever a new breath was measured (e.g. its timestamp). */
  breathKey?: number | null;
  /** Ripple size for that breath, 0..1 (distance from the band). */
  breathSize?: number;
  /** 0..1 progress of the in-band hold. */
  hold?: number;
}

export interface WaterSurfaceProps {
  height: number;
  state: () => WaterState;
  /** Resting water line as a fraction of the height. */
  surface?: number;
}

interface Ring {
  born: number;
  size: number;
  x: number;
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
    let glass = 0;
    let lastKey: number | null | undefined;
    let ambientNext = 0;
    const rings: Ring[] = [];
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
      const glassTarget = s.still ? 1 : Math.max(0, Math.min(1, s.hold ?? 0));
      glass += (glassTarget - glass) * 0.05;

      // A ripple per measured breath, sized by its distance from the band.
      if (s.breathKey !== undefined && s.breathKey !== null && s.breathKey !== lastKey) {
        if (lastKey !== undefined && !s.still) {
          rings.push({
            born: t,
            size: Math.max(0.08, Math.min(1, s.breathSize ?? energy)),
            x: 0.5 + Math.sin(t * 7.3) * 0.08,
          });
        }
        lastKey = s.breathKey;
      }
      // Without breath events (paced pause), drop gentle ambient ripples.
      if (s.breathKey === undefined && !s.still && t >= ambientNext) {
        rings.push({ born: t, size: 0.25 + energy * 0.5, x: 0.5 });
        ambientNext = t + 2.2;
      }
      while (rings.length > 12 || (rings.length > 0 && t - rings[0].born > 7)) rings.shift();

      const surfaceY = h * surface - breath * h * 0.035;

      // Sky.
      const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
      sky.addColorStop(0, '#08121b');
      sky.addColorStop(1, '#0c1c28');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Light source above the water.
      const glow = ctx.createRadialGradient(w * 0.5, surfaceY * 0.35, 4, w * 0.5, surfaceY * 0.35, h * 0.5);
      glow.addColorStop(0, `rgba(160, 235, 225, ${(0.16 + glass * 0.12).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(160, 235, 225, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Water body with a wavy surface (swell follows the smoothed distance from the band).
      const amp = 1.5 + energy * 13 * (1 - glass * 0.6);
      const surfaceAt = (px: number) => {
        const u = px / w;
        return (
          surfaceY +
          amp *
            (0.55 * Math.sin(u * 9 + t * 1.6) +
              0.3 * Math.sin(u * 23 - t * 2.3 + 1.2) +
              0.15 * Math.sin(u * 51 + t * 3.1 + 0.4))
        );
      };
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w; px += 6) ctx.lineTo(px, surfaceAt(px));
      ctx.lineTo(w, h);
      ctx.closePath();
      const water = ctx.createLinearGradient(0, surfaceY - amp, 0, h);
      water.addColorStop(0, '#12384a');
      water.addColorStop(0.35, '#0b2635');
      water.addColorStop(1, '#050d14');
      ctx.fillStyle = water;
      ctx.fill();

      // Reflection of the light: broken streaks when rough, one clean column as glass.
      const colW = w * 0.06;
      const rows = 28;
      const rough = energy * (1 - glass);
      for (let k = 0; k < rows; k++) {
        const yy = surfaceY + 10 + k * ((h - surfaceY - 20) / rows);
        const jitter = rough * 24 * Math.sin(t * 2.2 + k * 1.7);
        const width = colW * (1 - k / (rows * 1.3)) * (1 + rough * 0.9 * Math.sin(t * 3 + k));
        const alpha = (0.2 - k * 0.006) * (0.5 + 0.5 * (1 - rough)) + glass * 0.05;
        if (alpha <= 0) continue;
        ctx.fillStyle = `rgba(170, 240, 230, ${alpha.toFixed(3)})`;
        ctx.fillRect(w * 0.5 - width / 2 + jitter, yy, width, 2 + (1 - rough) * 6);
      }

      // Breath ripples spreading on the surface.
      const maxR = w * 0.5;
      for (const ring of rings) {
        const age = t - ring.born;
        const r = 8 + age * (60 + ring.size * 90);
        const fade = Math.max(0, 1 - age / 7) * Math.max(0, 1 - r / maxR);
        const alpha = fade * (0.15 + 0.6 * ring.size) * (1 - glass * 0.7);
        if (alpha < 0.01) continue;
        ctx.strokeStyle = `rgba(150, 225, 220, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1 + ring.size * 1.5;
        ctx.beginPath();
        ctx.ellipse(w * ring.x, surfaceY + 30 + r * 0.1, r, r * 0.15, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Surface highlight: brighter as the water stills.
      ctx.strokeStyle = `rgba(200, 250, 242, ${(0.16 + (1 - energy) * 0.2 + glass * 0.15).toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 6) {
        const yy = surfaceAt(px);
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
