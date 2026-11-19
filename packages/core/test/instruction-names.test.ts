/**
 * The names the instruction files use (AGENTS.md, CONTRIBUTING.md, CLAUDE.md, the guides, the skills and their
 * playbooks, the Cursor rules): a file, a function, a constant or a command an agent is told to open or run must
 * exist, and a name given WITH its file must be in that file. A rename or a move then fails here instead of leaving
 * a sentence that sends an agent to nothing.
 *
 * What this proves: existence and location. What it does not: that a sentence about what a function DOES is true,
 * that a name is the right one for the behavior described, or that a number in the prose is right (one count is
 * checked: the publish workflow's jobs, which the release steps tell the maintainer to watch). The prose is the
 * readers'.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** Every file under a folder, as repository-relative paths with `/`, skipping what is never source. */
function walk(rel: string, out: string[] = []): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage' || name === '.git') continue;
    const child = rel === '' ? name : `${rel}/${name}`;
    if (statSync(join(ROOT, child)).isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

/** The instruction files: what an agent reads before it works here. */
function instructionFiles(): string[] {
  const md = (dir: string) => walk(dir).filter((f) => /\.(md|mdc)$/.test(f));
  return ['AGENTS.md', 'CONTRIBUTING.md', 'CLAUDE.md', ...md('guides'), ...md('.claude/skills'), ...md('.cursor/rules'), ...md('.cursor/skills')].filter(
    (f) => existsSync(join(ROOT, f)),
  );
}

/** The folders a name may be relative to: the root, the packages folder, a package, the workflows folder. */
const PACKAGE_DIRS = readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}`);
const BASES = ['', 'packages', ...PACKAGE_DIRS, '.github/workflows', '.github'];

/** Every tracked-looking file of the repository, once (the docs folder is private and never named). */
const ALL_FILES = walk('').filter((f) => !f.startsWith('docs/'));

/** Every place a named path can be: repository-relative paths, empty when nothing in the repository answers to it. */
function resolvePaths(named: string): string[] {
  const clean = named.replace(/^(\.\.\/|\.\/)+/, '').replace(/\/$/, '');
  if (clean === '') return [];
  // A bare file name (`kinds.ts`): every file of that name, since the sentence around it says which one.
  if (!clean.includes('/')) return existsSync(join(ROOT, clean)) ? [clean] : ALL_FILES.filter((f) => f.endsWith(`/${clean}`));
  for (const base of BASES) {
    const candidate = base === '' ? clean : `${base}/${clean}`;
    if (existsSync(join(ROOT, candidate))) return [candidate];
  }
  // A path written from inside a source folder (`bracket/format.ts`, `share/cards.ts`): the files that end with it.
  return ALL_FILES.filter((f) => f.endsWith(`/${clean}`));
}

/** The text the names are looked for in: shipped source, scripts, workflows and the manifests. Never a test. */
const SOURCE_FILES = ALL_FILES.filter(
  (f) =>
    /\.(ts|tsx|mjs|js|sh|yml|json)$/.test(f) &&
    !/(^|\/)(test|fixtures)\//.test(f) &&
    !f.startsWith('packages/plugin-tests/') &&
    !f.includes('/src/data/') &&
    f !== 'pnpm-lock.yaml',
);
const WORDS_BY_FILE = new Map<string, Set<string>>();
const wordsOf = (file: string): Set<string> => {
  let words = WORDS_BY_FILE.get(file);
  if (!words) {
    words = new Set(read(join(ROOT, file)).match(/[A-Za-z_$][\w$]*/g) ?? []);
    WORDS_BY_FILE.set(file, words);
  }
  return words;
};
const SOURCE_WORDS = new Set<string>();
for (const f of SOURCE_FILES) for (const w of wordsOf(f)) SOURCE_WORDS.add(w);

/** Scripts a `pnpm <name>` may run: the root's and every package's, and pnpm's own commands. */
const SCRIPTS = new Set<string>(['install', 'audit', 'update', 'exec', 'add', 'dlx', 'pack', 'publish', 'run']);
for (const pkg of ['package.json', ...PACKAGE_DIRS.map((d) => `${d}/package.json`)]) {
  if (!existsSync(join(ROOT, pkg))) continue;
  for (const name of Object.keys((JSON.parse(read(join(ROOT, pkg))) as { scripts?: Record<string, string> }).scripts ?? {})) SCRIPTS.add(name);
}

/**
 * Names that are real and are not this repository's source: each with the reason, so an entry is a decision and
 * never a way to silence a rename.
 */
const OUTSIDE: Record<string, string> = {
  // identifiers
  COVERED_ELSEWHERE: "the canary test's own list (packages/core/test/espn-canary.test.ts): a test holds it by design",
  DRC: 'an example of a three-letter value a user may type, not a name in the code',
  EXTENDED_GLOB: 'a zsh option the release guide tells the maintainer about',
  headBranch: 'a field of the GitHub CLI output',
  // paths
  'config.json': "the user's saved choice, in the user's config folder",
  'CLAUDE.local.md': "the maintainer's private, untracked file",
  'server/mcp.js': "a file of the MCP SDK's installed package",
  'server/stdio.js': "a file of the MCP SDK's installed package",
  'packages/core/dist': 'a build output',
  'packages/notifier': 'a planned package, stated as planned',
  'services/gateway': 'a planned service, stated as planned',
};

const PATH_EXT = /\.(ts|tsx|mjs|js|json|md|sh|yml|mdc)$/;
const PATH_ROOT = /^(packages|scripts|guides|services|\.claude|\.cursor|\.github|core|cli|mcp|src|hooks|types)\//;
const isPath = (t: string) =>
  /^[\w.@/-]+$/.test(t) && !t.startsWith('@') && !t.startsWith('/') && !/^\.[a-z.]+$/.test(t) && (PATH_EXT.test(t) || PATH_ROOT.test(t) || /^\.\.?\//.test(t));
const isIdentifier = (t: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && (/[a-z][A-Z]/.test(t) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(t));

interface Finding {
  kind: 'path' | 'identifier' | 'location' | 'command';
  name: string;
  detail: string;
}

/** What a text names that the repository does not hold. Pure over the text: the repository is read, never written. */
function check(text: string): Finding[] {
  const findings: Finding[] = [];
  const tokens = [...text.matchAll(/`([^`\n]+)`/g)];
  const seen = new Set<string>();
  for (const m of tokens) {
    const raw = m[1] as string;
    const t = raw.replace(/\(\)$/, '');
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (Object.hasOwn(OUTSIDE, t)) continue;
    const pnpm = /^pnpm (?:-r |-F \S+ )?(?:run )?([\w:.-]+)/.exec(raw);
    if (pnpm) {
      if (!SCRIPTS.has(pnpm[1] as string)) findings.push({ kind: 'command', name: raw, detail: `no script "${pnpm[1]}" in a package.json` });
    } else if (isPath(t)) {
      if (resolvePaths(t).length === 0) findings.push({ kind: 'path', name: t, detail: 'no such file or folder' });
    } else if (isIdentifier(t)) {
      if (!SOURCE_WORDS.has(t)) findings.push({ kind: 'identifier', name: t, detail: 'in no source, script, workflow or manifest' });
    }
  }
  // A name given with its file: `name` (`file`...   `name` in `file`   `name`, `file`
  for (const m of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)(?:\(\))?`(?: \(| in | of |, in )(?:core |cli |mcp |the |core's |cli's )?`([^`\n]+)`/g)) {
    const name = m[1] as string;
    const where = m[2] as string;
    if (!isIdentifier(name) || !isPath(where) || Object.hasOwn(OUTSIDE, name) || Object.hasOwn(OUTSIDE, where)) continue;
    const places = resolvePaths(where);
    if (places.length === 0) continue; // reported above as a path
    const files = places.flatMap((place) =>
      statSync(join(ROOT, place)).isDirectory() ? ALL_FILES.filter((f) => f.startsWith(`${place}/`) && /\.(ts|tsx|mjs|js|sh|yml|json)$/.test(f)) : [place],
    );
    if (!files.some((f) => wordsOf(f).has(name))) findings.push({ kind: 'location', name, detail: `not in ${where}` });
  }
  return findings;
}

describe('the names the instruction files use', () => {
  const files = instructionFiles();

  it('reads the instruction files (AGENTS.md, the guides, the playbooks, the Cursor rules)', () => {
    expect(files).toContain('AGENTS.md');
    expect(files.some((f) => f.startsWith('guides/conventions/'))).toBe(true);
    expect(files.some((f) => f.includes('/playbooks/'))).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(25);
  });

  for (const file of files) {
    it(`${file}: every path, identifier and pnpm script it names exists, and a name is in the file it is given with`, () => {
      const found = check(read(join(ROOT, file)));
      expect(found.map((f) => `${f.kind} \`${f.name}\`: ${f.detail}`)).toEqual([]);
    });
  }

  it('is not vacuous: AGENTS.md alone names at least a hundred paths and a hundred identifiers it checks', () => {
    const tokens = new Set([...read(join(ROOT, 'AGENTS.md')).matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] as string).replace(/\(\)$/, '')));
    expect([...tokens].filter(isPath).length).toBeGreaterThanOrEqual(100);
    expect([...tokens].filter(isIdentifier).length).toBeGreaterThanOrEqual(100);
  });

  it('every name on the outside list is still used, and still outside (an entry never outlives its reason)', () => {
    const all = files.map((f) => read(join(ROOT, f))).join('\n');
    for (const name of Object.keys(OUTSIDE)) {
      expect(all.includes(`\`${name}`), `${name} is named by an instruction file`).toBe(true);
      if (isIdentifier(name)) expect(SOURCE_WORDS.has(name), `${name} is in the source now: remove it from the list`).toBe(false);
    }
  });
});

describe('the check fails on the mistakes it exists for', () => {
  it('a path that does not exist (a file renamed or removed)', () => {
    expect(check('see `packages/core/test/trust-parity-gone.test.ts` and `scripts/no-such-script.sh`').map((f) => f.kind)).toEqual(['path', 'path']);
    expect(check('`packages/core/src/trust/espn.ts` is the model')).toEqual([]);
  });

  it('a function or a constant no source holds (a rename), and one that survives only in a test', () => {
    expect(check('`knockoutWindowOfOld` filters, bounded by `MAX_GROUPS_OLD`').map((f) => `${f.kind}:${f.name}`)).toEqual(['identifier:knockoutWindowOfOld', 'identifier:MAX_GROUPS_OLD']);
    expect(check('`knockoutWindowOf` filters, bounded by `MAX_GROUPS`')).toEqual([]);
    // `testPackages` is a helper of rule-table.test.ts: a name only a test holds is not a name of the product.
    expect(check('`testPackages` decides').map((f) => f.kind)).toEqual(['identifier']);
  });

  it('a name given with the wrong file (PR #250: `formatShareBracket` was listed under the share folder)', () => {
    expect(check('the formatter `formatShareBracket` in `packages/core/src/share/format.ts`').map((f) => `${f.kind}:${f.name}`)).toEqual(['location:formatShareBracket']);
    expect(check('the formatter `formatShareBracket` in `../bracket/format.ts`')).toEqual([]);
    expect(check('`stageFromSlug` (`core/src/trust/espn.ts`) bounds the raw value')).toEqual([]);
    expect(check('`stageFromSlug` (`core/src/trust/match.ts`) bounds the raw value').map((f) => f.kind)).toEqual(['location']);
  });

  it('a pnpm script no package.json has', () => {
    expect(check('run `pnpm release:qa-old`').map((f) => f.kind)).toEqual(['command']);
    expect(check('run `pnpm release:qa`, `pnpm -F @claudinho/core test` and `pnpm -r build`')).toEqual([]);
  });
});

describe('the one count the release steps act on', () => {
  it('the publish workflow has the four jobs AGENTS.md tells the maintainer to watch, by name', () => {
    const yml = read(join(ROOT, '.github/workflows/publish.yml'));
    const jobs = [...yml.slice(yml.indexOf('\njobs:')).matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
    const agents = read(join(ROOT, 'AGENTS.md'));
    expect(agents).toContain('four jobs (`build`, `publish`, `release`, `mcp-registry`)');
    expect(jobs).toEqual(['build', 'publish', 'release', 'mcp-registry']);
  });
});
