import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { listFiles, read } from './repoFiles';

const importRe =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function importsOf(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  importRe.lastIndex = 0;
  while ((m = importRe.exec(text)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('engine purity', () => {
  const engineFiles = listFiles('src/engine').filter((f) => f.endsWith('.ts'));

  it('has engine files', () => {
    expect(engineFiles.length).toBeGreaterThan(3);
  });

  it.each(engineFiles)('%s imports only other engine modules', (file) => {
    for (const spec of importsOf(read(file))) {
      expect(spec.startsWith('.'), `${file} imports bare module "${spec}"`).toBe(true);
      const resolved = path.normalize(path.join(path.dirname(file), spec));
      expect(
        resolved.startsWith(path.normalize('src/engine')),
        `${file} reaches outside src/engine via "${spec}"`,
      ).toBe(true);
    }
  });

  it.each(engineFiles)('%s uses no DOM, Node, or Electron globals', (file) => {
    const code = stripComments(read(file));
    for (const token of [
      'window.',
      'document.',
      'navigator.',
      'process.',
      'require(',
      'setTimeout(',
      'setInterval(',
      'Date.now(',
      'performance.now(',
    ]) {
      expect(code.includes(token), `${file} uses ${token}`).toBe(false);
    }
  });
});

describe('SDK isolation', () => {
  // The renderer-side SDK API is touched ONLY by PresageSignalSource. The
  // Electron main/preload wiring the SDK requires (bindSmartSpectraIpc and the
  // preload bridge) are the only other permitted imports.
  const allowed = new Set([
    path.normalize('src/signals/PresageSignalSource.ts'),
    path.normalize('src/main/sdkBridge.ts'),
    path.normalize('src/preload/preload.ts'),
    path.normalize('src/declarations.d.ts'),
  ]);
  const srcFiles = listFiles('src').filter((f) => /\.(ts|tsx)$/.test(f));

  it.each(srcFiles)('%s respects the SDK boundary', (file) => {
    const touchesSdk = importsOf(read(file)).some((s) => s.startsWith('@smartspectra/'));
    if (touchesSdk) expect(allowed.has(path.normalize(file)), `${file} imports @smartspectra/*`).toBe(true);
  });
});
