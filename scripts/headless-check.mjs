#!/usr/bin/env node
/**
 * Headless SmartSpectra check (no Electron, no camera).
 *
 * Constructs the SDK in plain Node, feeds frames, and reports what came back:
 * processing-status transitions, validation codes, decoded metrics fields, and
 * errors. Never prints the API key.
 *
 *   node scripts/headless-check.mjs                     # synthetic frames via useCustomInput()/sendFrame()
 *   node scripts/headless-check.mjs --video=face.mp4    # a recorded clip via useFile() (SDK decodes it)
 *   node scripts/headless-check.mjs --seconds=40        # how long to feed synthetic frames
 *
 * Synthetic frames contain no real face, so expect validation codes such as
 * kNoFaceFound rather than metrics; they prove the native runtime loads,
 * authentication runs, and the event plumbing works. A 30-60 s clip of a
 * well-lit, still face (see the SDK's headless-testing guide) is needed to see
 * pulse and breathing readings.
 *
 * Exit code 0 when the SDK started and produced events; 1 on an SDK error or
 * if nothing came back.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const apiKey = (process.env.PRESAGE_API_KEY ?? process.env.SMARTSPECTRA_API_KEY ?? '').trim();
if (!apiKey) {
  console.error('headless-check: set PRESAGE_API_KEY (or SMARTSPECTRA_API_KEY). Nothing was run.');
  process.exit(2);
}

const VIDEO = arg('video', null);
const SECONDS = Number(arg('seconds', 30));
const WIDTH = 640;
const HEIGHT = 480;
const FPS = 30;

let sdkMod;
let messages;
try {
  sdkMod = require('@smartspectra/node-sdk');
  messages = require('@smartspectra/node-sdk/messages');
} catch (err) {
  console.error(`headless-check: the SDK failed to load: ${err.message}`);
  process.exit(1);
}
const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  SmartSpectraErrorCode,
  PixelFormat,
  FrameTransform,
  MetricType,
} = sdkMod;
const { decodeMetrics } = messages;

const nameOf = (table, value) => Object.entries(table).find(([, v]) => v === value)?.[0] ?? String(value);

const report = {
  sdkVersion: SmartSpectraSDK.version,
  platform: `${process.platform}-${process.arch}`,
  input: VIDEO
    ? `useFile(${VIDEO})`
    : `useCustomInput() + ${SECONDS}s of synthetic ${WIDTH}x${HEIGHT} RGB frames`,
  processingStatus: [],
  validation: {},
  metricsEvents: 0,
  fieldsSeen: {},
  latest: {},
  errors: [],
  framesSent: 0,
  framesAccepted: 0,
};

const seen = (path, value) => {
  report.fieldsSeen[path] = (report.fieldsSeen[path] ?? 0) + 1;
  if (value !== undefined) report.latest[path] = value;
};

const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [
    MetricType.CHEST_BREATHING,
    MetricType.ABDOMEN_BREATHING,
    MetricType.BREATHING_RATE,
    MetricType.PULSE_RATE,
    MetricType.HRV,
    MetricType.TALKING,
    MetricType.BLINKING,
  ],
  enableTelemetry: false,
});

let settledResolve;
const settled = new Promise((r) => (settledResolve = r));
let started = false;

sdk.on('processingStatus', (status) => {
  report.processingStatus.push(nameOf(ProcessingStatus, status));
  if (status === ProcessingStatus.kRunning) started = true;
  if (started && (status === ProcessingStatus.kIdle || status === ProcessingStatus.kError)) settledResolve();
});
sdk.on('validationStatus', (code, _ts, hint) => {
  const key = `${nameOf(ValidationCode, code)}${hint ? ` (${hint})` : ''}`;
  report.validation[key] = (report.validation[key] ?? 0) + 1;
});
sdk.on('metrics', (buf) => {
  report.metricsEvents++;
  let m;
  try {
    m = decodeMetrics(buf);
  } catch (err) {
    report.errors.push(`decode failed: ${err.message}`);
    return;
  }
  const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined);
  if (m.breathing?.upperTrace?.length) seen('breathing.upperTrace', last(m.breathing.upperTrace).value);
  if (m.breathing?.rate?.length) {
    const r = last(m.breathing.rate);
    seen('breathing.rate', `${r.value.toFixed(1)} (conf ${r.confidence.toFixed(0)})`);
  }
  if (m.cardio?.pulseRate?.length) {
    const p = last(m.cardio.pulseRate);
    seen('cardio.pulseRate', `${p.value.toFixed(0)} (conf ${p.confidence.toFixed(0)})`);
  }
  if (m.cardio?.hrv?.length) seen('cardio.hrv', `rmssd ${last(m.cardio.hrv).rmssd.toFixed(0)}`);
  if (m.face?.talking?.length) seen('face.talking', last(m.face.talking).detected);
  if (m.face?.blinking?.length) seen('face.blinking', last(m.face.blinking).detected);
});
sdk.on('error', (code, message, retryable) => {
  report.errors.push(
    `${nameOf(SmartSpectraErrorCode, code)} (${code}): ${message}${retryable ? ' [retryable]' : ''}`,
  );
  settledResolve();
});

/** A synthetic RGB frame: a skin-toned oval on gray, brightness pulsing at 72 bpm, "chest" moving at 15 br/min. */
function syntheticFrame(i) {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 3);
  const t = i / FPS;
  const pulse = 1 + 0.01 * Math.sin(2 * Math.PI * 1.2 * t);
  const chest = Math.round(6 * Math.sin(2 * Math.PI * 0.25 * t));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const o = (y * WIDTH + x) * 3;
      const dx = (x - WIDTH / 2) / 90;
      const dy = (y - 190) / 120;
      const inFace = dx * dx + dy * dy < 1;
      const inChest = y > 330 + chest && Math.abs(x - WIDTH / 2) < 180;
      if (inFace) {
        buf[o] = Math.min(255, 205 * pulse);
        buf[o + 1] = 160;
        buf[o + 2] = 135;
      } else if (inChest) {
        buf[o] = 70;
        buf[o + 1] = 90;
        buf[o + 2] = 120;
      } else {
        buf[o] = buf[o + 1] = buf[o + 2] = 120;
      }
    }
  }
  return buf;
}

async function main() {
  const t0 = Date.now();
  try {
    if (VIDEO) {
      sdk.useFile(VIDEO);
      sdk.start();
      await Promise.race([settled, new Promise((r) => setTimeout(r, 180_000))]);
    } else {
      sdk.useCustomInput(FrameTransform.kNone);
      sdk.start();
      const startUs = Date.now() * 1000;
      const total = SECONDS * FPS;
      for (let i = 0; i < total; i++) {
        const ok = sdk.sendFrame(
          syntheticFrame(i),
          WIDTH,
          HEIGHT,
          WIDTH * 3,
          PixelFormat.kRGB,
          startUs + Math.round(i * (1e6 / FPS)),
        );
        report.framesSent++;
        if (ok) report.framesAccepted++;
        await new Promise((r) => setTimeout(r, 1000 / FPS));
        if (report.errors.length > 0 && i > FPS * 3) break;
      }
      await sdk.stopAsync();
    }
  } catch (err) {
    report.errors.push(`lifecycle: ${err.message}${err.code !== undefined ? ` (code ${err.code})` : ''}`);
  } finally {
    try {
      await sdk.destroy();
    } catch {
      /* ignore */
    }
  }
  report.elapsedS = Math.round((Date.now() - t0) / 1000);
  report.verdict =
    report.metricsEvents > 0
      ? 'metrics event fired and decoded'
      : report.errors.length > 0
        ? 'SDK loaded and started, then reported an error (see errors)'
        : Object.keys(report.validation).length > 0
          ? 'SDK running and validating frames; no metrics (expected without a real face)'
          : 'no events received';
  console.log(JSON.stringify(report, null, 2));
  process.exit(
    report.errors.length > 0 || (report.metricsEvents === 0 && Object.keys(report.validation).length === 0)
      ? 1
      : 0,
  );
}

main();
