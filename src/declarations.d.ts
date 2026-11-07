/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare module '@smartspectra/node-sdk/preload';

interface Window {
  composure?: import('./shared/ipc').ComposureBridge;
}
