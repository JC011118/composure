/**
 * Preload bridge (sandboxed, context-isolated).
 *
 * 1. Installs the SmartSpectra SDK's own bridge (`window.__smartspectraBridge`),
 *    which @smartspectra/node-sdk/renderer uses to ship frames to the main
 *    process over a MessagePort. Harmless in simulator mode: nothing attaches
 *    unless the renderer constructs the SDK.
 * 2. Exposes a narrow `window.composure` API (see src/shared/ipc.ts).
 */

import '@smartspectra/node-sdk/preload';
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ComposureBridge } from '../shared/ipc';

const bridge: ComposureBridge = {
  boot: () => ipcRenderer.invoke(IPC.boot),
  getApiKey: () => ipcRenderer.invoke(IPC.getApiKey),
  readReplay: () => ipcRenderer.invoke(IPC.readReplay),
  sessions: {
    list: () => ipcRenderer.invoke(IPC.sessionsList),
    save: (json) => ipcRenderer.invoke(IPC.sessionsSave, json),
    load: (id) => ipcRenderer.invoke(IPC.sessionsLoad, id),
    delete: (id) => ipcRenderer.invoke(IPC.sessionsDelete, id),
    reveal: () => ipcRenderer.invoke(IPC.sessionsReveal),
  },
  savePng: (dataUrl, suggestedName) => ipcRenderer.invoke(IPC.savePng, dataUrl, suggestedName),
  saveRecording: (json) => ipcRenderer.invoke(IPC.saveRecording, json),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
};

contextBridge.exposeInMainWorld('composure', bridge);
