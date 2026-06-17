import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const hasDist = existsSync(CLI);

describe.skipIf(!hasDist)('cmdPrompt — Cursor stdin integration', () => {
  let dir: string;
  const origCache = process.env.XDG_CACHE_HOME;
  const origMeta = process.env.CLAUDINHO_CURSOR_META;
  const origComp = process.env.CLAUDINHO_COMPETITION;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-stdin-'));
    process.env.XDG_CACHE_HOME = dir;
    process.env.CLAUDINHO_CURSOR_META = 'auto';
    delete process.env.CLAUDINHO_COMPETITION;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (origCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = origCache;
    if (origMeta === undefined) delete process.env.CLAUDINHO_CURSOR_META;
    else process.env.CLAUDINHO_CURSOR_META = origMeta;
    if (origComp === undefined) delete process.env.CLAUDINHO_COMPETITION;
    else process.env.CLAUDINHO_COMPETITION = origComp;
  });

  it('drains stdin and renders a meta line for Cursor payload', () => {
    const payload = JSON.stringify({
      model: { display_name: 'Composer 2.5' },
      context_window: { used_percentage: 12 },
    });
    const r = spawnSync(process.execPath, [CLI, 'prompt'], {
      env: { ...process.env, NO_COLOR: '1' },
      input: payload,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Composer 2.5');
    expect(r.stdout).toContain('ctx 12%');
    expect(r.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });
});
