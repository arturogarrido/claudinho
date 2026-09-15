/**
 * References to the maintainer-private `docs/` folder, found in text.
 *
 * `docs/` at the repo root is gitignored and private. A tracked file that names
 * a path under it (`docs/PLAN.md`, `./docs/PLAN.md`, `../docs/PLAN.md`,
 * `/docs/PLAN.md`) leaks a private path and goes stale whenever the private
 * tree is reorganised. A bare `docs/` — the boundary rules in .gitignore, the
 * CI comment, the PR checklist — is fine: it names the folder, not a file.
 *
 * URLs are not local paths: `https://example.com/docs/x` and a scheme-less
 * `cursor.com/docs/x` are left alone. Only the ROOT folder is private, so
 * `packages/mcp/docs/x` is not a hit either.
 *
 * Used by scripts/check-pack.mjs (CI's pack guard) and pinned by
 * packages/core/test/private-doc-refs.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Any URL with a scheme, removed wholesale before tokenising so nothing inside
// it (including a `/docs/` segment) can be read as a local path.
const SCHEME_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`)\]]+/gi;
// A path-like run. Quotes, backticks, brackets, parens, `<>`, `*`, `!`, `@`,
// `\`, `:` and whitespace end a token, so `[x](./docs/a.md)`, `!docs/a.md`
// (a gitignore exception), `@docs/a.md` (a CLAUDE.md import) and
// `docs/<name>` (a placeholder) tokenise the way a reader reads them.
const TOKEN = /[A-Za-z0-9._~/?#%+=-]+/g;
// `cursor.com`, `biomejs.dev`, `sub.example.co.uk`: a scheme-less URL's host.
const HOSTNAME = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** True when `token` names a path INSIDE the root `docs/` folder. */
export function isPrivateDocRef(token) {
  const segs = token.split('/');
  if (HOSTNAME.test(segs[0] ?? '')) return false;
  let i = 0;
  while (i < segs.length && (segs[i] === '' || segs[i] === '.' || segs[i] === '..')) i++;
  // The next segment must be a NAME: `docs/.` is the bare folder ending a
  // sentence, `docs/...` is a placeholder — neither names a file.
  return segs[i] === 'docs' && !/^\.*$/.test(segs[i + 1] ?? '');
}

/** Every private-doc reference in `text`, with 1-based line numbers. */
export function privateDocRefs(text) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(SCHEME_URL, ' ');
    for (const token of line.match(TOKEN) ?? []) {
      if (isPrivateDocRef(token)) hits.push({ line: i + 1, token });
    }
  }
  return hits;
}

/**
 * Scan every git-tracked text file under `root` (binaries skipped).
 * Returns the number of files scanned and each leak as `file:line: token`.
 */
export function scanTrackedFiles(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const leaks = [];
  for (const f of files) {
    const buf = readFileSync(join(root, f));
    if (buf.includes(0)) continue; // binary
    for (const { line, token } of privateDocRefs(buf.toString('utf8'))) {
      leaks.push(`${f}:${line}: ${token}`);
    }
  }
  return { scanned: files.length, leaks };
}
