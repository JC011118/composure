import { useEffect, useState } from 'react';
import type { BootInfo } from '../shared/ipc';

export function App() {
  const [boot, setBoot] = useState<BootInfo | null>(null);
  useEffect(() => {
    void window.composure?.boot().then(setBoot);
  }, []);
  return (
    <main className="screen" data-screen="boot">
      <h1 className="title">Composure</h1>
      <p className="lede">Interview rehearsal that trains recovery.</p>
      <p className="muted">Mode: {boot ? `${boot.mode} (${boot.modeReason})` : 'starting…'}</p>
    </main>
  );
}
