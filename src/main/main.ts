import { app, BrowserWindow, dialog, ipcMain, session, shell, systemPreferences } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { apiKeyFromEnv, parseCli, type CliOptions } from './cli';
import { SessionStore } from './sessionStore';
import { bindSdk, configureNativeRuntimePath } from './sdkBridge';
import { EXTERNAL_URL_ALLOWLIST, IPC, type BootInfo, type SaveResult } from '../shared/ipc';

if (started) app.quit();

const cli: CliOptions = parseCli(process.argv.slice(1), process.env);
const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);
let configOverride: unknown = null;
const bootWarnings = [...cli.warnings];
let sessionStore: SessionStore | null = null;

// Mode is logged; the API key never is.
console.log(`[composure] booting in ${cli.mode} mode (${cli.modeReason})`);

async function loadConfigOverride(): Promise<void> {
  if (!cli.configFile) return;
  try {
    configOverride = JSON.parse(await fs.readFile(path.resolve(cli.configFile), 'utf8'));
    console.log(`[composure] loaded config override from ${cli.configFile}`);
  } catch (err) {
    bootWarnings.push(`Could not read --config file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function bootInfo(): BootInfo {
  return {
    mode: cli.mode,
    modeReason: cli.modeReason,
    isDev,
    platform: process.platform,
    appVersion: app.getVersion(),
    sim: { seed: cli.simSeed, speed: cli.simSpeed, scenario: cli.simScenario },
    replayFile: cli.replayFile ? path.resolve(cli.replayFile) : null,
    recordSignals: cli.recordSignals,
    configOverride,
    warnings: bootWarnings,
  };
}

/** The exact page we load in production. */
const OWN_FILE_URL = pathToFileURL(
  path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
).href;

/**
 * Is `url` our own page: the bundled index.html (file://, exact path) or, in
 * dev only, the Vite dev server origin? Any other local file or site is not.
 */
function isOwnPage(url: string): boolean {
  if (!url) return false;
  const bare = url.split('#')[0].split('?')[0];
  if (bare === OWN_FILE_URL) return true;
  if (isDev && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** Only our own top-level page may call the privileged IPC handlers. */
function fromOwnPage(e: Electron.IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame;
  return !!frame && frame.parent === null && isOwnPage(frame.url);
}

function installPermissionHandlers(): void {
  // Grant ONLY the camera (video-only 'media'), and ONLY to our own page.
  // Microphone, notifications, geolocation, etc. are always denied. In dev the
  // page is served by the Vite dev server on localhost, so that origin is
  // allowed too; packaged builds only ever load file:// pages.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && 'requestingUrl' in details && details.requestingUrl) || wc?.getURL() || '';
    const mediaTypes = (details && 'mediaTypes' in details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    const allowed = cli.mode === 'real' && permission === 'media' && cameraOnly && isOwnPage(url);
    if (!allowed || process.platform !== 'darwin') {
      callback(allowed);
      return;
    }
    // macOS: make sure the system camera prompt (TCC) is shown and honoured.
    if (systemPreferences.getMediaAccessStatus('camera') === 'granted') {
      callback(true);
      return;
    }
    systemPreferences
      .askForMediaAccess('camera')
      .then((granted) => callback(granted))
      .catch(() => callback(false));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    if (permission !== 'media' || cli.mode !== 'real') return false;
    return details.mediaType === 'video' && isOwnPage(details.requestingUrl ?? '');
  });
}

function registerIpc(): void {
  sessionStore = new SessionStore(path.join(app.getPath('userData'), 'sessions'));
  const store = sessionStore;

  ipcMain.handle(IPC.boot, () => bootInfo());
  ipcMain.handle(IPC.getApiKey, (e) =>
    cli.mode === 'real' && fromOwnPage(e) ? apiKeyFromEnv(process.env) : null,
  );
  ipcMain.handle(IPC.readReplay, async () => {
    if (!cli.replayFile) return null;
    try {
      return await fs.readFile(path.resolve(cli.replayFile), 'utf8');
    } catch (err) {
      console.error(
        `[composure] cannot read replay file: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  });
  ipcMain.handle(IPC.sessionsList, (e) => (fromOwnPage(e) ? store.list() : []));
  ipcMain.handle(IPC.sessionsSave, (e, json: unknown) =>
    fromOwnPage(e) && typeof json === 'string' ? store.save(json) : { ok: false, error: 'bad payload' },
  );
  ipcMain.handle(IPC.sessionsLoad, (e, id: unknown) =>
    fromOwnPage(e) && typeof id === 'string' ? store.load(id) : null,
  );
  ipcMain.handle(IPC.sessionsDelete, (e, id: unknown) =>
    fromOwnPage(e) && typeof id === 'string' ? store.delete(id) : false,
  );
  ipcMain.handle(IPC.sessionsReveal, async () => {
    const dir = path.join(app.getPath('userData'), 'sessions');
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
  ipcMain.handle(IPC.savePng, async (e, dataUrl: unknown, suggestedName: unknown): Promise<SaveResult> => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      return { ok: false, error: 'expected a PNG data URL' };
    }
    const win = BrowserWindow.fromWebContents(e.sender);
    const name =
      typeof suggestedName === 'string' ? suggestedName.replace(/[^\w.-]/g, '_') : 'composure-card.png';
    const opts = {
      defaultPath: path.join(app.getPath('pictures'), name.endsWith('.png') ? name : `${name}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    await fs.writeFile(res.filePath, buf);
    return { ok: true, path: res.filePath };
  });
  ipcMain.handle(IPC.saveRecording, async (e, json: unknown): Promise<SaveResult> => {
    if (typeof json !== 'string') return { ok: false, error: 'bad payload' };
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      defaultPath: path.join(app.getPath('documents'), `composure-recording-${Date.now()}.json`),
      filters: [{ name: 'Composure signal recording', extensions: ['json'] }],
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    await fs.writeFile(res.filePath, json, 'utf8');
    return { ok: true, path: res.filePath };
  });
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !EXTERNAL_URL_ALLOWLIST.includes(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

function createWindow(): void {
  const preload = path.join(__dirname, 'preload.cjs');
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#0b0f14',
    title: 'Composure',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (cli.mode === 'real') {
    const bound = bindSdk(win);
    if (!bound.ok) {
      bootWarnings.push(`SmartSpectra SDK failed to load in the main process: ${bound.error}`);
      console.error(`[composure] SDK bind failed: ${bound.error}`);
    }
  }

  // Never navigate away from our own page or open new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url)) event.preventDefault();
  });

  win.once('ready-to-show', () => win.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (cli.devtools) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  if (cli.mode === 'real') {
    const libPath = configureNativeRuntimePath(app.isPackaged, process.resourcesPath);
    if (libPath) console.log(`[composure] native runtime: ${libPath}`);
  }
  await loadConfigOverride();
  installPermissionHandlers();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
