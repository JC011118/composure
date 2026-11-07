import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../../src/main/sessionStore';

describe('SessionStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'composure-sessions-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const record = (id: string, createdAt: string) =>
    JSON.stringify({ format: 'composure-session', id, createdAt, mode: 'simulated', questions: [{}, {}] });

  it('saves, lists newest first, loads, and deletes', async () => {
    const store = new SessionStore(path.join(dir, 'sessions'));
    expect(await store.list()).toEqual([]);
    expect((await store.save(record('a1', '2026-11-07T01:00:00Z'))).ok).toBe(true);
    expect((await store.save(record('b2', '2026-11-07T02:00:00Z'))).ok).toBe(true);
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['b2', 'a1']);
    expect(list[0].questionCount).toBe(2);
    expect(JSON.parse((await store.load('a1')) as string).id).toBe('a1');
    expect(await store.delete('a1')).toBe(true);
    expect((await store.list()).map((s) => s.id)).toEqual(['b2']);
  });

  it('rejects non-session payloads and path tricks', async () => {
    const store = new SessionStore(dir);
    expect((await store.save('{"format":"other","id":"x"}')).ok).toBe(false);
    expect((await store.save('not json')).ok).toBe(false);
    expect((await store.save(record('../evil', 'x'))).ok).toBe(false);
    expect(await store.load('../../etc/passwd')).toBeNull();
    expect(await store.delete('../x')).toBe(false);
  });
});
