import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Dropping a file on the window must never navigate away from the app.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault());
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
