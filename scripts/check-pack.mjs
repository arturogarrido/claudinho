#!/usr/bin/env node
/**
 * Tarball-contents guard. `npm pack --dry-run` each publishable package and
 * assert nothing ships beyond dist/ + README.md + LICENSE + package.json —
 * and never a .mcpb bundle, anything under docs/, or a dotfile. Also asserts
 * git tracks nothing under docs/ (the 0.8.3 gitignore-exception leak class) and
 * that no tracked file names a path under docs/ (the folder is maintainer-
 * private; public code, comments, rules and templates must not cite it). CI
 * runs this after build; run locally from the repo root:
 *
 *   node scripts/check-pack.mjs
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTrackedFiles } from './private-doc-refs.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PKGS = ['core', 'cli', 'mcp'];
const ALLOWED = /^(dist\/|README\.md$|LICENSE$|package\.json$)/;
const FORBIDDEN = /^docs\/|\.mcpb$|(^|\/)\./; // docs/, .mcpb anywhere, any dotfile/dotdir

let failed = false;

for (const p of PKGS) {
  const dir = join(root, 'packages', p);
  const json = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [info] = JSON.parse(json);
  const files = info.files.map((f) => f.path);
  const bad = files.filter((f) => !ALLOWED.test(f) || FORBIDDEN.test(f));
  if (bad.length) {
    failed = true;
    console.error(`✗ @claudinho/${p} would ship unexpected files:\n   ${bad.join('\n   ')}`);
  } else {
    console.log(
      `✓ @claudinho/${p}: ${files.length} files, all expected (${(info.size / 1024).toFixed(0)} KB)`,
    );
  }
}

const tracked = execFileSync('git', ['ls-files', 'docs'], { cwd: root, encoding: 'utf8' }).trim();
if (tracked) {
  failed = true;
  console.error(
    `✗ git tracks files under docs/ — the private boundary is breached (check .gitignore for a "!docs/" exception):\n   ${tracked.split('\n').join('\n   ')}`,
  );
} else {
  console.log('✓ docs/ is untracked (private boundary holds)');
}

// No tracked file may NAME a path under docs/. The folder is maintainer-private,
// so a public comment, rule, link or template that cites `docs/<something>`
// (also as `./docs/…`, `../docs/…` or `/docs/…`) leaks a private path and goes
// stale the moment the private tree is reorganised. A bare `docs/` in the
// boundary rules themselves is fine; URLs are not local paths. The matcher
// lives in private-doc-refs.mjs and is pinned by core's private-doc-refs test.
const { scanned, leaks } = scanTrackedFiles(root);
if (leaks.length) {
  failed = true;
  console.error(
    `✗ tracked files name paths under docs/ (private) — cite nothing under it from public files:\n   ${leaks.join('\n   ')}`,
  );
} else {
  console.log(`✓ no tracked file names a path under docs/ (${scanned} files scanned)`);
}

process.exit(failed ? 1 : 0);
