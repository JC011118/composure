import { defineConfig } from 'vite';

// The SmartSpectra main-process entry (and its koffi FFI loader) must NOT be
// bundled: it resolves its per-platform native runtime package at runtime via
// require.resolve. Keep it external; forge.config.mts copies it into the
// packaged app.
export const SDK_MAIN_EXTERNALS = [
  '@smartspectra/node-sdk',
  '@smartspectra/node-sdk/main',
  'koffi',
];

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: SDK_MAIN_EXTERNALS,
    },
  },
});
