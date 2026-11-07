import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'out', 'coverage']);
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.css',
  '.html',
  '.txt',
  '.plist',
  '.yml',
  '.yaml',
]);

/** Recursively list text files under `rel` (relative to the repo root). */
export function listFiles(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return [rel];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = path.join(rel, name);
    const childAbs = path.join(ROOT, childRel);
    const cst = statSync(childAbs);
    if (cst.isDirectory()) out.push(...listFiles(childRel));
    else if (TEXT_EXT.has(path.extname(name))) out.push(childRel);
  }
  return out;
}

export function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Root-level files (docs, configs) — not recursive. */
export function rootTextFiles(): string[] {
  return readdirSync(ROOT).filter((name) => {
    const st = statSync(path.join(ROOT, name));
    return st.isFile() && TEXT_EXT.has(path.extname(name)) && name !== 'package-lock.json';
  });
}
