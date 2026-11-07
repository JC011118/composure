/**
 * IPC contract between the Electron main process, the preload bridge, and
 * the renderer. Types only plus channel-name constants; safe to import from
 * any process.
 */

export type BootMode = 'real' | 'simulated' | 'replay';

export interface BootInfo {
  mode: BootMode;
  /** Why this mode was chosen, shown in the UI and logs (never contains secrets). */
  modeReason: string;
  isDev: boolean;
  platform: string;
  appVersion: string;
  sim: {
    seed: number;
    speed: number;
    scenario: string;
  };
  /** Absolute path of a replay recording, when mode === 'replay'. */
  replayFile: string | null;
  /** True when `--record` was passed: offer "Save signal recording" at the end. */
  recordSignals: boolean;
  /** Parsed `--config=<path>` override (deep-partial EngineConfig), or null. */
  configOverride: unknown;
  /** Non-fatal problems found while booting (bad flag, unreadable file). */
  warnings: string[];
}

export interface SavedSessionSummary {
  id: string;
  createdAt: string;
  mode: string;
  questionCount: number;
  fileName: string;
}

export interface SaveResult {
  ok: boolean;
  /** Absolute path written, when ok. */
  path?: string;
  /** User cancelled a save dialog. */
  cancelled?: boolean;
  error?: string;
}

export const IPC = {
  boot: 'composure:boot',
  getApiKey: 'composure:get-api-key',
  readReplay: 'composure:read-replay',
  sessionsList: 'composure:sessions:list',
  sessionsSave: 'composure:sessions:save',
  sessionsLoad: 'composure:sessions:load',
  sessionsDelete: 'composure:sessions:delete',
  sessionsReveal: 'composure:sessions:reveal',
  savePng: 'composure:save-png',
  saveRecording: 'composure:save-recording',
  openExternal: 'composure:open-external',
} as const;

/** The API exposed on `window.composure` by the preload bridge. */
export interface ComposureBridge {
  boot(): Promise<BootInfo>;
  /** Real mode only; resolves null otherwise. Never log the result. */
  getApiKey(): Promise<string | null>;
  readReplay(): Promise<string | null>;
  sessions: {
    list(): Promise<SavedSessionSummary[]>;
    save(json: string): Promise<SaveResult>;
    load(id: string): Promise<string | null>;
    delete(id: string): Promise<boolean>;
    reveal(): Promise<void>;
  };
  savePng(dataUrl: string, suggestedName: string): Promise<SaveResult>;
  saveRecording(json: string): Promise<SaveResult>;
  /** Opens only allow-listed https URLs (SDK docs) in the system browser. */
  openExternal(url: string): Promise<boolean>;
}

/** URLs the renderer may open in the system browser. */
export const EXTERNAL_URL_ALLOWLIST: readonly string[] = [
  'https://smartspectra.presagetech.com/docs/telemetry-and-privacy',
  'https://smartspectra.presagetech.com/docs/llm-insights',
  'https://smartspectra.presagetech.com/docs/measurement-quality',
  'https://api.physiology.presagetech.com/privacypolicy',
];
