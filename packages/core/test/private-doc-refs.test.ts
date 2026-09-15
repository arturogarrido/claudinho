import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { isPrivateDocRef, privateDocRefs, scanTrackedFiles } from '../../../scripts/private-doc-refs.mjs';

/**
 * `docs/` at the repo root is maintainer-private (gitignored). `scripts/check-pack.mjs`
 * (CI's pack guard) fails when a tracked file names a path under it. The first version of
 * that guard excluded any `/` before `docs/` as "part of a URL", which let every relative
 * Markdown link (`./docs/<x>`, `../docs/<x>`, `/docs/<x>`) straight through (PR #125 review, P2).
 * These cases pin the matcher; the temp-repo case pins the scan; the last case pins the
 * CALL from check-pack.mjs, so deleting the call site goes red too.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
// The guard scans THIS file too, so every private-path fixture is assembled from `D`
// rather than written literally — the guard stays total, with no exemption for its own tests.
const D = 'docs';

describe('isPrivateDocRef', () => {
  it.each([
    `${D}/PRIVATE.md`,
    `./${D}/PRIVATE.md`,
    `/${D}/PRIVATE.md`,
    `../${D}/PRIVATE.md`,
    `../../${D}/PRIVATE.md`,
    `${D}/wc2026/`,
    `${D}/metrics/daily.csv`,
  ])('flags a local path under the root docs folder: %s', (token) => {
    expect(isPrivateDocRef(token)).toBe(true);
  });

  it.each([
    'docs/', // the folder itself, as the boundary rules name it
    'docs',
    'cursor.com/docs/reference/plugins', // scheme-less URL
    'github.com/arturogarrido/claudinho/tree/main/docs', // scheme-less URL
    'packages/mcp/docs/x', // only the ROOT docs/ is private
    'docs/.', // the bare folder ending a sentence
    'docs/...', // a placeholder
    'mydocs/x',
    'docs.example.com/x',
    '',
  ])('leaves alone: %s', (token) => {
    expect(isPrivateDocRef(token)).toBe(false);
  });
});

describe('privateDocRefs (text, as a reader reads it)', () => {
  it.each([
    ['a Markdown link', `[plan](./${D}/PLAN.md)`, `./${D}/PLAN.md`],
    ['a root-relative Markdown link', `[plan](/${D}/PLAN.md)`, `/${D}/PLAN.md`],
    ['a parent-relative link', `see ../${D}/PLAN.md for details`, `../${D}/PLAN.md`],
    ['a backticked path', `the \`${D}/NOTEBOOK.md\` notebook`, `${D}/NOTEBOOK.md`],
    ['a gitignore exception', `!${D}/PRD.md`, `${D}/PRD.md`],
    ['a CLAUDE.md import', `@${D}/NOTEBOOK.md`, `${D}/NOTEBOOK.md`],
    ['a sentence-final path', `see ${D}/X.md.`, `${D}/X.md.`],
    ['a colon-glued path', `plan:${D}/X.md`, `${D}/X.md`],
  ])('finds %s', (_label, text, token) => {
    expect(privateDocRefs(text)).toEqual([{ line: 1, token }]);
  });

  it.each([
    ['the .gitignore entry', 'docs/'],
    ['the boundary rule', '**Gitignored (maintainer-local):** `docs/` and `CLAUDE.local.md`.'],
    ['the CI comment', '# .mcpb or anything under docs/ (and git must track nothing under docs/).'],
    ['the guard message', 'check .gitignore for a "!docs/" exception'],
    ['a placeholder', 'fails on any `docs/<name>` reference'],
    ['a dotted placeholder', 'never add `!docs/...` exceptions'],
    ['the bare folder ending a sentence', '// No tracked file may NAME a path under docs/. The folder is private.'],
    ['a regex source', 'const FORBIDDEN = /^docs\\/|\\.mcpb$|(^|\\/)\\./;'],
    ['an https URL', 'see https://example.com/docs/private.md for the spec'],
    ['an http URL in parens', '(http://example.com/a/docs/private.md)'],
    ['a scheme-less URL', 'Spec: cursor.com/docs/reference/plugins.'],
    ['a nested docs folder', 'packages/mcp/docs/x'],
  ])('allows %s', (_label, text) => {
    expect(privateDocRefs(text)).toEqual([]);
  });

  it('reports 1-based line numbers and every hit on a line', () => {
    const text = `clean\nsee ${D}/A.md and ./${D}/B.md\nclean\n/${D}/C.md\n`;
    expect(privateDocRefs(text)).toEqual([
      { line: 2, token: `${D}/A.md` },
      { line: 2, token: `./${D}/B.md` },
      { line: 4, token: `/${D}/C.md` },
    ]);
  });
});

describe('scanTrackedFiles', () => {
  const repo = mkdtempSync(join(tmpdir(), 'claudinho-private-doc-refs-'));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('scans only tracked text files and reports file:line: token', () => {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), `# hi\n\nRead [the plan](./${D}/PLAN.md).\n`);
    writeFileSync(join(repo, 'ok.md'), 'Private notes live under docs/ (gitignored).\n');
    writeFileSync(join(repo, 'bin.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`${D}/SECRET.md`)]));
    writeFileSync(join(repo, 'untracked.md'), `not added: ${D}/UNTRACKED.md\n`);
    execFileSync('git', ['add', 'README.md', 'ok.md', 'bin.dat'], { cwd: repo });

    expect(scanTrackedFiles(repo)).toEqual({ scanned: 3, leaks: [`README.md:3: ./${D}/PLAN.md`] });
  });
});

describe('scripts/check-pack.mjs', () => {
  it('calls scanTrackedFiles on the repo root (pins the call, not just the function)', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'check-pack.mjs'), 'utf8');
    expect(src).toMatch(/import \{ scanTrackedFiles \} from '\.\/private-doc-refs\.mjs';/);
    expect(src).toMatch(/scanTrackedFiles\(root\)/);
  });

  it('finds no private-doc reference in the tracked tree', () => {
    expect(scanTrackedFiles(ROOT).leaks).toEqual([]);
  });
});
