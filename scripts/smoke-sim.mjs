#!/usr/bin/env node
/**
 * Simulator-mode smoke test.
 *
 * Launches `electron-forge start -- --sim` (under xvfb-run on a headless
 * Linux box), attaches over the Chrome DevTools Protocol, checks that the
 * renderer mounted without console errors, optionally drives a whole
 * simulated session to the debrief, and saves screenshots.
 *
 *   node scripts/smoke-sim.mjs                       # boot check only
 *   node scripts/smoke-sim.mjs --full --speed=8      # drive consent → debrief
 *   node scripts/smoke-sim.mjs --shots=out/shots     # screenshot directory
 *   node scripts/smoke-sim.mjs --camera-free          # camera-free session driven with the Space key
 *   node scripts/smoke-sim.mjs --real --observe=40    # REAL mode with Chromium's fake camera:
 *                                                     # checks the SDK wiring end to end (needs PRESAGE_API_KEY)
 *
 * Requires Playwright (`npm i -D playwright` or a global install); it is only
 * used to attach to the already-running Electron window over CDP.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return args.includes(`--${name}`) ? true : dflt;
};

const FULL = Boolean(flag('full', false));
const SPEED = Number(flag('speed', FULL ? 8 : 1));
const SHOTS = String(flag('shots', 'out/smoke'));
const PORT = Number(flag('port', 9333));
const SCENARIO = String(flag('scenario', 'demo'));
const REAL = Boolean(flag('real', false));
const CAMERA_FREE = Boolean(flag('camera-free', false));
const OBSERVE_S = Number(flag('observe', 40));
const TIMEOUT_MS = Number(
  flag('timeout', FULL ? 420_000 : REAL ? OBSERVE_S * 1000 + 90_000 : CAMERA_FREE ? 240_000 : 90_000),
);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error(
    'smoke-sim: Playwright is not installed. Run `npm i -D playwright` (no browser download needed).',
  );
  process.exit(2);
}

mkdirSync(SHOTS, { recursive: true });

const appArgs = REAL
  ? [
      // Chromium's synthetic camera (a moving test pattern, no face) and auto-accepted capture UI.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--remote-debugging-port=${PORT}`,
    ]
  : ['--sim', `--sim-speed=${SPEED}`, `--sim-scenario=${SCENARIO}`, `--remote-debugging-port=${PORT}`];
if (REAL && !process.env.PRESAGE_API_KEY && !process.env.SMARTSPECTRA_API_KEY) {
  console.error('smoke-sim --real needs PRESAGE_API_KEY in the environment.');
  process.exit(2);
}
if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
  appArgs.push('--no-sandbox');
}
const forgeCmd = ['electron-forge', 'start', '--', ...appArgs];
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const cmd = useXvfb ? 'xvfb-run' : 'npx';
const cmdArgs = useXvfb ? ['-a', 'npx', ...forgeCmd] : forgeCmd;

console.log(`smoke-sim: launching ${cmd} ${cmdArgs.join(' ')}`);
const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let appLog = '';
child.stdout.on('data', (d) => (appLog += d));
child.stderr.on('data', (d) => (appLog += d));

const cleanup = () => {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + TIMEOUT_MS;

async function waitForCdp() {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('CDP endpoint never came up');
}

async function main() {
  await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page;
  while (!page && Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => !p.url().startsWith('devtools://'));
    if (!page) await sleep(300);
  }
  if (!page) throw new Error('no app page found');

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.waitForSelector('[data-screen]', { timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, '01-boot.png') });
  const screen = await page.getAttribute('[data-screen]', 'data-screen');
  console.log(`smoke-sim: first screen = ${screen}`);

  if (FULL) {
    await driveFullSession(page);
    await exerciseSavedSessions(page);
  } else if (CAMERA_FREE) {
    await driveCameraFree(page);
  } else if (REAL) {
    await observeReal(page);
  }

  const fatal = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/.test(e));
  if (fatal.length > 0) {
    console.error('smoke-sim: console errors:\n  ' + fatal.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('smoke-sim: OK (no console errors)');
  }
  await browser.close().catch(() => {});
}

async function observeReal(page) {
  await page.check('[data-testid="consent-optin"]');
  await page.click('[data-testid="consent-begin"]');
  const t0 = Date.now();
  let shot = 2;
  while (Date.now() - t0 < OBSERVE_S * 1000) {
    await sleep(5_000);
    const screen = await page.getAttribute('[data-screen]', 'data-screen').catch(() => null);
    const hud = (await page.textContent('[data-testid="hud"]').catch(() => '')) ?? '';
    const banners = await page
      .$$eval('.banner', (els) => els.map((e) => e.textContent?.trim() ?? ''))
      .catch(() => []);
    console.log(
      `smoke-real: t=${Math.round((Date.now() - t0) / 1000)}s screen=${screen} hud="${hud.replace(/\s+/g, ' ').trim()}"`,
    );
    for (const b of banners) console.log(`smoke-real:   banner: ${b}`);
    await page.screenshot({ path: path.join(SHOTS, `${String(shot++).padStart(2, '0')}-real.png`) });
  }
  const tail = appLog
    .split('\n')
    .filter((l) => /smartspectra|composure|SmartSpectra/i.test(l))
    .slice(-25);
  console.log('smoke-real: app log (SDK lines):\n  ' + tail.join('\n  '));
}

async function exerciseSavedSessions(page) {
  await page.click('[data-testid="save-session"]');
  await page.waitForSelector('text=Session saved', { timeout: 10_000 });
  console.log('smoke-sim: session saved');
  await page.click('text=New session');
  await page.waitForSelector('[data-screen="consent"]');
  console.log('smoke-sim: back at consent');
  await page.click('button:has-text("Saved sessions")');
  await page.waitForSelector('[data-screen="sessions"]');
  console.log('smoke-sim: sessions list shown');
  const rows = await page.$$('.session-row');
  if (rows.length < 1) throw new Error('saved session not listed');
  console.log(`smoke-sim: ${rows.length} saved session(s) listed`);
  await page.click('.session-row >> button:has-text("Open")');
  await page.waitForSelector('[data-screen="debrief"]');
  console.log('smoke-sim: saved debrief opened');
  await page.screenshot({ path: path.join(SHOTS, '20-saved-debrief.png') });
  page.once('dialog', (d) => void d.accept());
  await page.click('button:has-text("Delete this session")');
  await page.waitForSelector('[data-screen="sessions"]');
  const after = await page.$$('.session-row');
  if (after.length !== rows.length - 1) throw new Error('delete did not remove the session');
  console.log('smoke-sim: saved session opened and deleted');
}

async function driveCameraFree(page) {
  await page.click('.segmented >> text=2');
  await page.check('[data-testid="consent-camerafree"]');
  await page.check('[data-testid="consent-optin"]');
  await page.click('[data-testid="consent-begin"]');
  const seen = new Set();
  let shot = 30;
  while (Date.now() < deadline) {
    const screen = await page.getAttribute('[data-screen]', 'data-screen').catch(() => null);
    if (screen && !seen.has(screen)) {
      seen.add(screen);
      console.log(`smoke-cf: reached ${screen}`);
      await page.screenshot({ path: path.join(SHOTS, `${shot++}-cf-${screen}.png`) });
    }
    if (screen === 'debrief') break;
    if (screen === 'interview') {
      const line = (await page.textContent('[data-testid="listening"]').catch(() => '')) ?? '';
      if (/Hold Space/.test(line)) {
        // Answer for 12 s by holding Space, then stay quiet.
        await page.keyboard.down('Space');
        await sleep(12_000);
        await page.keyboard.up('Space');
      }
    }
    await sleep(500);
  }
  if (!seen.has('debrief')) throw new Error(`camera-free never reached debrief; saw ${[...seen].join(', ')}`);
  const text = (await page.textContent('[data-screen="debrief"]')) ?? '';
  if (!/paced pause/.test(text)) throw new Error('camera-free debrief should show paced pauses');
  if (/bpm vs/.test(text) && !/camera off/.test(text))
    throw new Error('camera-free debrief must not show pulse numbers');
  console.log('smoke-cf: camera-free session reached the debrief with paced pauses and no physiology');
}

async function driveFullSession(page) {
  const seen = new Set();
  // Consent: opt in and begin.
  await page.check('[data-testid="consent-optin"]');
  await page.click('[data-testid="consent-begin"]');
  let shot = 2;
  while (Date.now() < deadline) {
    const screen = await page.getAttribute('[data-screen]', 'data-screen').catch(() => null);
    if (screen && !seen.has(screen)) {
      seen.add(screen);
      console.log(`smoke-sim: reached ${screen}`);
      await sleep(screen === 'gate' ? 1500 : 400);
      await page.screenshot({ path: path.join(SHOTS, `${String(shot++).padStart(2, '0')}-${screen}.png`) });
    }
    if (screen === 'debrief') break;
    if (screen === 'gate' && !seen.has('recovered-card')) {
      const card = await page.$('[data-testid="recovered-card"]');
      if (card) {
        seen.add('recovered-card');
        await sleep(700);
        await page.screenshot({
          path: path.join(SHOTS, `${String(shot++).padStart(2, '0')}-gate-recovered.png`),
        });
      }
    }
    await sleep(500);
  }
  if (!seen.has('debrief')) throw new Error(`never reached debrief; saw ${[...seen].join(', ')}`);
  await sleep(1000);
  await page.screenshot({
    path: path.join(SHOTS, `${String(shot++).padStart(2, '0')}-debrief-full.png`),
    fullPage: true,
  });
  for (const required of ['baselineSeated', 'baselineTalking', 'interview', 'gate', 'debrief']) {
    if (!seen.has(required)) throw new Error(`screen ${required} was never shown`);
  }
}

main()
  .catch((err) => {
    console.error(`smoke-sim: FAILED: ${err.message}`);
    console.error('--- app log (tail) ---\n' + appLog.split('\n').slice(-40).join('\n'));
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });
