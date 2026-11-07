import { defineConfig } from 'vite';

// The preload is bundled (sandboxed preloads cannot require arbitrary
// modules), including @smartspectra/node-sdk/preload, which only needs
// `electron`.
export default defineConfig({});
