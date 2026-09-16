import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initCursorStatusline, initHook, initStatusline } from '../src/install';

/**
 * Audit A13 (P3): valid JSON with an invalid settings envelope (`[]`, `null`,
 * a string) reported `written` while serializing the same invalid document
 * back — no statusline installed, a misleading success. Now the root must be
 * a non-null, non-array object and the hook containers must have the shapes
 * we mutate; anything else is an honest `manual` result with NO write and NO
 * backup.
 */
let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-envelope-'));
  path = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const untouched = (raw: string) => {
  expect(readFileSync(path, 'utf8')).toBe(raw);
  expect(existsSync(`${path}.claudinho.bak`)).toBe(false);
};

describe('invalid settings envelopes', () => {
  it.each(['[]', 'null', '"a string"', '42'])('root %s → manual, nothing written', (raw) => {
    writeFileSync(path, raw);
    for (const run of [initStatusline, initCursorStatusline, initHook]) {
      const r = run({ path });
      expect(r.action).toBe('manual');
      expect(r.message).toContain('{'); // the paste-ready snippet is offered
      untouched(raw);
    }
  });

  it.each(['{"hooks":[]}', '{"hooks":"x"}', '{"hooks":{"UserPromptSubmit":{}}}'])(
    'hook container %s → manual, nothing written',
    (raw) => {
      writeFileSync(path, raw);
      const r = initHook({ path });
      expect(r.action).toBe('manual');
      untouched(raw);
    },
  );

  it.each([
    '{"hooks":{"UserPromptSubmit":[null]}}',
    '{"hooks":{"UserPromptSubmit":[{"hooks":{}}]}}',
    '{"hooks":{"UserPromptSubmit":[{"hooks":[null]}]}}',
  ])('malformed nested hook entry %s → manual, nothing written, no exception', (raw) => {
    // Review P3 on #127: the outer array was validated, its contents were not,
    // and enumerating commands threw instead of returning the manual path.
    writeFileSync(path, raw);
    const r = initHook({ path });
    expect(r.action).toBe('manual');
    untouched(raw);
  });

  it.skipIf(process.platform === 'win32')(
    'a dangling settings symlink is preserved and refused, never replaced by a file',
    () => {
      // Review P3 on #127: `realpath` failing was read as "absent", so the link
      // was replaced by a regular file and its intended target stayed missing.
      const missing = join(dir, 'missing.json');
      symlinkSync(missing, path);
      for (const run of [initStatusline, initCursorStatusline, initHook]) {
        const r = run({ path });
        expect(r.action).toBe('manual');
        // The precise reason, not the generic "could not parse" a failed read
        // through the link would also produce: a mutant that drops the check
        // lands on `manual` by that other path and must still go red here.
        expect(r.message).toContain('symlink to a missing file');
        expect(lstatSync(path).isSymbolicLink()).toBe(true);
        expect(existsSync(missing)).toBe(false);
        expect(existsSync(`${path}.claudinho.bak`)).toBe(false);
      }
    },
  );

  it('a valid object root still installs (no regression)', () => {
    writeFileSync(path, '{"theme":"dark"}');
    expect(initStatusline({ path }).action).toBe('written');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      theme: 'dark',
      statusLine: { type: 'command' },
    });
  });
});
