import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdStar } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { bumpRunCount, REPO_URL, shouldNudge } from '../src/starNudge';

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en') });

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('shouldNudge', () => {
  it('fires only on every 5th run', () => {
    expect(shouldNudge(0)).toBe(false);
    expect(shouldNudge(4)).toBe(false);
    expect(shouldNudge(5)).toBe(true);
    expect(shouldNudge(6)).toBe(false);
    expect(shouldNudge(10)).toBe(true);
  });
});

describe('bumpRunCount', () => {
  it('increments and persists a best-effort counter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudinho-star-'));
    const p = join(dir, 'runs.json');
    try {
      expect(bumpRunCount(p)).toBe(1);
      expect(bumpRunCount(p)).toBe(2);
      expect(bumpRunCount(p)).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws when the store is unavailable (returns undefined)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudinho-star-'));
    const asFile = join(dir, 'afile');
    writeFileSync(asFile, 'x');
    try {
      // The parent is a regular file, so mkdir fails → best-effort returns undefined.
      expect(bumpRunCount(join(asFile, 'runs.json'))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cmdStar', () => {
  it('prints the repo link and the vibe tag (text)', () => {
    cmdStar(ctx());
    const o = text();
    expect(o).toContain(REPO_URL);
    expect(o).toContain('#VibingLaVidaLoca');
  });

  it('emits a structured payload in --json', () => {
    cmdStar(ctx({ json: true }));
    const data = JSON.parse(text()) as { repo: string; hashtag: string };
    expect(data.repo).toBe(REPO_URL);
    expect(data.hashtag).toBe('#VibingLaVidaLoca');
  });
});
