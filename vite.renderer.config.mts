import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the renderer.
 *  - worker-src 'self' blob: is required by the SmartSpectra renderer SDK.
 *  - media-src blob: mediastream: lets the <video> preview show the camera.
 *  - The dev variant additionally allows the Vite dev server (HMR websocket and
 *    the React refresh preamble). Production stays strict.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const DEV_CSP = PROD_CSP.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
).replace(
  "connect-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:*",
);

function cspPlugin(): Plugin {
  let isDev = false;
  return {
    name: 'composure-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml(html) {
      return html.replace('__COMPOSURE_CSP__', isDev ? DEV_CSP : PROD_CSP);
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), cspPlugin()],
  optimizeDeps: {
    // Pre-bundle the SDK's renderer entry points. Otherwise Vite discovers them
    // only when real mode dynamically imports them and reloads the page mid-start.
    include: ['@smartspectra/node-sdk/renderer', '@smartspectra/node-sdk/messages'],
  },
});
