/**
 * Real-mode SmartSpectra wiring for the main process.
 *
 * Only loaded when the app boots in real mode, so simulator mode never touches
 * the native runtime. The SDK's `bindSmartSpectraIpc(win)` owns the IPC channel
 * that backs `@smartspectra/node-sdk/renderer`; frames arrive from the renderer
 * over a MessagePort and never leave memory.
 */

import path from 'node:path';
import type { BrowserWindow } from 'electron';

const NATIVE_LIB: Record<string, string> = {
  darwin: 'libsmartspectra_capi.dylib',
  win32: 'smartspectra_capi.dll',
  linux: 'libsmartspectra_capi.so',
};

/**
 * In a packaged build the native runtime closure ships as an extra resource
 * (see forge.config.mts), not inside app.asar — a dylib cannot be dlopen'd
 * from an asar archive. Point the binding's resolver at it BEFORE requiring
 * the binding. In dev (`npm run dev`) the resolver finds the per-platform npm
 * package by itself.
 */
export function configureNativeRuntimePath(isPackaged: boolean, resourcesPath: string): string | null {
  if (!isPackaged || process.env.SMARTSPECTRA_CAPI_PATH) return null;
  const lib = NATIVE_LIB[process.platform];
  if (!lib) return null;
  const dir = `node-sdk-${process.platform}-${process.arch}`;
  const libPath = path.join(resourcesPath, dir, lib);
  process.env.SMARTSPECTRA_CAPI_PATH = libPath;
  return libPath;
}

export interface SdkBindResult {
  ok: boolean;
  error?: string;
}

export function bindSdk(win: BrowserWindow): SdkBindResult {
  try {
    // Kept as a runtime require (externalized in vite.main.config.mts) so the
    // native runtime is resolved from node_modules / extra resources.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bindSmartSpectraIpc } =
      require('@smartspectra/node-sdk/main') as typeof import('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(win, {
      logger: (level, msg) => {
        const line = `[smartspectra/main] ${msg}`;
        if (level === 'error') console.error(line);
        else if (level === 'warn') console.warn(line);
        else console.log(line);
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
