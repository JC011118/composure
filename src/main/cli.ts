/**
 * Command-line + environment parsing for the main process. No Electron
 * imports so it can be unit-tested.
 *
 *   npm run dev                      real mode if PRESAGE_API_KEY is set, else simulator
 *   npm run dev -- --sim             force simulator
 *   npm run dev -- --sim --sim-seed=7 --sim-speed=4 --sim-scenario=demo
 *   npm run dev -- --replay=path/to/recording.json
 *   npm run dev -- --record          offer "Save signal recording" after a session
 *   npm run dev -- --config=overrides.json
 *   npm run dev -- --devtools
 */

import type { BootMode } from '../shared/ipc';

export interface CliOptions {
  mode: BootMode;
  modeReason: string;
  hasApiKey: boolean;
  simSeed: number;
  simSpeed: number;
  simScenario: string;
  replayFile: string | null;
  recordSignals: boolean;
  configFile: string | null;
  devtools: boolean;
  warnings: string[];
}

export const SIM_SCENARIOS = ['demo', 'full', 'steady', 'timeout', 'cueB'] as const;

function flagValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith(prefix)) return a.slice(prefix.length);
    if (a === `--${name}` && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      return argv[i + 1];
    }
  }
  return undefined;
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

/** The API key, from PRESAGE_API_KEY (preferred) or SMARTSPECTRA_API_KEY (SDK docs' convention). */
export function apiKeyFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const key = (env.PRESAGE_API_KEY ?? env.SMARTSPECTRA_API_KEY ?? '').trim();
  return key.length > 0 ? key : null;
}

export function parseCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): CliOptions {
  const warnings: string[] = [];
  const hasApiKey = apiKeyFromEnv(env) !== null;

  const seedRaw = flagValue(argv, 'sim-seed');
  let simSeed = 20261104;
  if (seedRaw !== undefined) {
    const n = Number.parseInt(seedRaw, 10);
    if (Number.isFinite(n)) simSeed = n;
    else warnings.push(`Ignoring --sim-seed=${seedRaw} (not an integer).`);
  }

  const speedRaw = flagValue(argv, 'sim-speed');
  let simSpeed = 1;
  if (speedRaw !== undefined) {
    const n = Number.parseFloat(speedRaw);
    if (Number.isFinite(n) && n >= 0.25 && n <= 20) simSpeed = n;
    else warnings.push(`Ignoring --sim-speed=${speedRaw} (expected 0.25-20).`);
  }

  const scenarioRaw = flagValue(argv, 'sim-scenario');
  let simScenario = 'demo';
  if (scenarioRaw !== undefined) {
    if ((SIM_SCENARIOS as readonly string[]).includes(scenarioRaw)) simScenario = scenarioRaw;
    else
      warnings.push(`Ignoring --sim-scenario=${scenarioRaw} (expected one of ${SIM_SCENARIOS.join(', ')}).`);
  }

  const replayFile = flagValue(argv, 'replay') ?? null;
  const configFile = flagValue(argv, 'config') ?? null;

  let mode: BootMode;
  let modeReason: string;
  if (replayFile) {
    mode = 'replay';
    modeReason = '--replay flag';
  } else if (hasFlag(argv, 'sim')) {
    mode = 'simulated';
    modeReason = '--sim flag';
  } else if (!hasApiKey) {
    mode = 'simulated';
    modeReason = 'PRESAGE_API_KEY is not set';
  } else {
    mode = 'real';
    modeReason = 'PRESAGE_API_KEY is set';
  }

  return {
    mode,
    modeReason,
    hasApiKey,
    simSeed,
    simSpeed,
    simScenario,
    replayFile,
    recordSignals: hasFlag(argv, 'record'),
    configFile,
    devtools: hasFlag(argv, 'devtools'),
    warnings,
  };
}
