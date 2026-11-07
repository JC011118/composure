#!/usr/bin/env node
/**
 * Summarize saved Composure sessions for hardware tuning.
 *
 *   node scripts/session-report.mjs                    # every session in the default userData folder
 *   node scripts/session-report.mjs path/a.json dir/   # specific files or folders
 *   node scripts/session-report.mjs --last=2           # only the newest N sessions
 *
 * For each Gate: outcome, recovery time, time in band, and (when recorded)
 * how long each criterion kept the Gate closed. For each answer: clean pulse
 * coverage. Ends with the MORNING_CHECKLIST.md rule: if more than 1 in 3 Gates
 * timed out, which constants to loosen first.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const lastArg = args.find((a) => a.startsWith('--last='));
const last = lastArg ? Number(lastArg.split('=')[1]) : null;
const inputs = args.filter((a) => !a.startsWith('--'));

function defaultDir() {
  const home = os.homedir();
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'Composure', 'sessions');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? home, 'Composure', 'sessions');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Composure', 'sessions');
}

function collect(p) {
  let st;
  try {
    st = statSync(p);
  } catch {
    console.error(`session-report: cannot read ${p}`);
    return [];
  }
  if (st.isDirectory())
    return readdirSync(p)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(p, f));
  return [p];
}

const files = (inputs.length ? inputs : [defaultDir()]).flatMap(collect);
let sessions = files
  .map((f) => {
    try {
      const s = JSON.parse(readFileSync(f, 'utf8'));
      return s.format === 'composure-session' ? { file: f, s } : null;
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((a, b) => (a.s.createdAt < b.s.createdAt ? -1 : 1));
if (last) sessions = sessions.slice(-last);
if (sessions.length === 0) {
  console.log(
    `session-report: no saved sessions found in ${inputs.length ? inputs.join(', ') : defaultDir()}`,
  );
  process.exit(0);
}

const fmt = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const pad = (s, n) => String(s).padEnd(n);

const gates = [];
const answers = [];
for (const { file, s } of sessions) {
  console.log(`\n${s.createdAt}  mode=${s.mode}  ${path.basename(file)}`);
  const band = s.baselines?.band;
  if (band) {
    console.log(
      `  band: period ${fmt(band.periodLoMs)}–${fmt(band.periodHiMs)}  amplitude ${band.ampLo?.toFixed?.(3)}–${band.ampHi?.toFixed?.(3)}${band.personal ? '' : '  (wide fallback)'}`,
    );
  }
  console.log(
    `  ${pad('Q', 4)}${pad('gate', 12)}${pad('recovery', 10)}${pad('in band', 9)}${pad('pulse cov', 11)}${pad('cues', 7)}closed by`,
  );
  for (const q of s.questions ?? []) {
    const reasons = q.gate?.outReasonMs
      ? Object.entries(q.gate.outReasonMs)
          .filter(([, ms]) => ms > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([r, ms]) => `${r} ${fmt(ms)}`)
          .join(', ')
      : '(not recorded)';
    console.log(
      `  ${pad(`Q${q.index + 1}`, 4)}${pad(q.recovery, 12)}${pad(fmt(q.recoveryTimeMs), 10)}${pad(pct(q.gate?.inBandFraction), 9)}${pad(pct(q.pulse?.coverage), 11)}${pad((q.cues ?? []).map((c) => c.cue).join('') || '-', 7)}${reasons}`,
    );
    gates.push(q);
    if (q.answerStartMs !== null) answers.push(q);
  }
  if (s.hrv)
    console.log(
      `  session HRV: rmssd ${s.hrv.rmssd.toFixed(0)} ms, stable=${s.hrv.stable}, conf ${s.hrv.confidence.toFixed(0)}`,
    );
}

const measured = gates.filter((q) => q.recovery === 'settled' || q.recovery === 'timed out');
const timedOut = measured.filter((q) => q.recovery === 'timed out');
const settled = measured.filter((q) => q.recovery === 'settled');
const med = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};
console.log('\nSummary');
console.log(
  `  Gates measured: ${measured.length}   settled: ${settled.length}   timed out: ${timedOut.length}`,
);
console.log(`  median recovery (settled): ${fmt(med(settled.map((q) => q.recoveryTimeMs)))}`);
const covs = answers.map((q) => q.pulse?.coverage ?? 0);
console.log(
  `  pulse coverage per answer: ${covs.map(pct).join(' ')}   (≥60% needed to show a pulse delta: ${covs.filter((c) => c >= 0.6).length}/${covs.length})`,
);

const totals = {};
for (const q of measured)
  for (const [r, ms] of Object.entries(q.gate?.outReasonMs ?? {})) totals[r] = (totals[r] ?? 0) + ms;
const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
if (ranked.length)
  console.log(
    `  time the Gate was held closed, by reason: ${ranked.map(([r, ms]) => `${r} ${fmt(ms)}`).join(', ')}`,
  );

if (measured.length > 0 && timedOut.length / measured.length > 1 / 3) {
  const LOOSEN = {
    amplitude: 'gate.minAmplitudeHalfWidthFrac 0.15 → 0.25, then gate.bandSdMultiplier 1.5 → 2.0',
    period: 'gate.minPeriodHalfWidthMs 400 → 700, then gate.bandSdMultiplier 1.5 → 2.0',
    excursion: 'gate.excursionTolerance 1.15 → 1.5',
    held: 'gate.turningPointSlack 0.75 → 1.25',
    'no-cycle': 'cycles.hysteresisFrac 0.3 → 0.2 (small or noisy trace), gate.turningPointSlack 0.75 → 1.25',
    gap: 'not a constant: fix lighting / framing / stillness (see the HUD hints)',
    'no-data': 'not a constant: the SDK stopped sending data (check the HUD and the terminal)',
  };
  console.log(`\nMore than 1 in 3 Gates timed out. Loosen in this order (via --config first):`);
  for (const [r] of ranked.slice(0, 3)) console.log(`  - ${r}: ${LOOSEN[r] ?? 'see MORNING_CHECKLIST.md'}`);
  console.log('  - last resort: gate.holdMs 5000 → 4000 (record it in DECISIONS.md: the brief says 5 s)');
} else if (measured.length > 0) {
  console.log('\nTimeout rate is within the 1-in-3 rule; no loosening needed.');
}
