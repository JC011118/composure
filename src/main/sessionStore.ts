/**
 * Saved sessions live as individual JSON files in <userData>/sessions/.
 * Nothing is written unless the user clicks "Save session". No frames, no
 * video, no audio — the renderer only ever sends the engine's JSON record.
 *
 * No Electron imports (the directory is injected) so it is unit-testable.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SavedSessionSummary, SaveResult } from '../shared/ipc';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_SESSION_BYTES = 20 * 1024 * 1024;

export class SessionStore {
  constructor(private readonly dir: string) {}

  private fileFor(id: string): string {
    if (!ID_RE.test(id)) throw new Error('invalid session id');
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<SavedSessionSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: SavedSessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!ID_RE.test(id)) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, name), 'utf8');
        const parsed = JSON.parse(raw) as {
          createdAt?: unknown;
          mode?: unknown;
          questions?: unknown;
        };
        out.push({
          id,
          createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
          mode: typeof parsed.mode === 'string' ? parsed.mode : 'unknown',
          questionCount: Array.isArray(parsed.questions) ? parsed.questions.length : 0,
          fileName: name,
        });
      } catch {
        // Skip unreadable or malformed files rather than failing the list.
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return out;
  }

  async save(json: string): Promise<SaveResult> {
    if (typeof json !== 'string' || json.length > MAX_SESSION_BYTES) {
      return { ok: false, error: 'session payload too large or not a string' };
    }
    let parsed: { id?: unknown; format?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'session payload is not valid JSON' };
    }
    if (parsed.format !== 'composure-session') {
      return { ok: false, error: 'not a Composure session record' };
    }
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    if (!ID_RE.test(id)) return { ok: false, error: 'invalid session id' };
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = this.fileFor(id);
    await fs.writeFile(file, json, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: file };
  }

  async load(id: string): Promise<string | null> {
    try {
      return await fs.readFile(this.fileFor(id), 'utf8');
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }
}
