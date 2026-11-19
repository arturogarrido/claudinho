/**
 * The names the instruction files use (AGENTS.md, CONTRIBUTING.md, CLAUDE.md, the guides, the skills and their
 * playbooks, the Cursor rules): a file, a function, a constant or a command an agent is told to open or run must
 * exist, and a name given WITH its file must be in that file. A rename or a move then fails here instead of leaving
 * a sentence that sends an agent to nothing.
 *
 * What this proves: existence and location, among the files git tracks, comments apart. What it does not: that a sentence about what a function DOES is true,
 * that a name is the right one for the behavior described, or that a number in the prose is right (one count is
 * checked: the publish workflow's jobs, which the release steps tell the maintainer to watch). The prose is the
 * readers'.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/**
 * The files git TRACKS, never the folder as it is on disk: an untracked or ignored copy (an old worktree under the
 * checkout, a build output, a scratch file) must not be what makes a gone name pass. The docs folder is private.
 */
const trackedFiles = (root: string): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((f) => f !== '' && !f.startsWith('docs/') && existsSync(join(root, f))); // tracked AND present: a deleted file not yet staged is gone
const ALL_FILES = trackedFiles(ROOT);
const TRACKED = new Set(ALL_FILES);
const DIRS = new Set<string>();
for (const f of ALL_FILES) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) DIRS.add(f.slice(0, i));
const exists = (rel: string) => TRACKED.has(rel) || DIRS.has(rel);

/** The instruction files: what an agent reads before it works here. */
function instructionFiles(): string[] {
  const under = (dir: string) => ALL_FILES.filter((f) => f.startsWith(`${dir}/`) && /\.(md|mdc)$/.test(f));
  return [...['AGENTS.md', 'CONTRIBUTING.md', 'CLAUDE.md'].filter((f) => TRACKED.has(f)), ...under('guides'), ...under('.claude/skills'), ...under('.cursor/rules'), ...under('.cursor/skills')];
}

/** The folders a name may be relative to: the root, the packages folder, a package, the workflows folder. */
const PACKAGE_DIRS = [...DIRS].filter((d) => /^packages\/[^/]+$/.test(d));
const BASES = ['', 'packages', ...PACKAGE_DIRS, '.github/workflows', '.github'];

/** `a/{b,c}/d` as `a/b/d` and `a/c/d` (one group, the form the files use). */
const braces = (named: string): string[] => {
  const m = /^(.*)\{([^{}]+)\}(.*)$/.exec(named);
  return m ? (m[2] as string).split(',').flatMap((part) => braces(`${m[1]}${part}${m[3]}`)) : [named];
};

/** Every place ONE named path can be (no braces): repository-relative paths, empty when nothing tracked answers to it. */
function placesOf(named: string): string[] {
  const clean = named.replace(/^(\.\.\/|\.\/)+/, '').replace(/\/$/, '');
  if (clean === '') return [];
  if (clean.includes('*')) {
    // A glob (`hooks/*.test.tsx`): a `*` stands for anything but a `/`.
    const re = new RegExp(`(^|/)${clean.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    return [...ALL_FILES, ...DIRS].filter((f) => re.test(f));
  }
  // A bare file name (`kinds.ts`): every file of that name, since the sentence around it says which one.
  if (!clean.includes('/')) return exists(clean) ? [clean] : ALL_FILES.filter((f) => f.endsWith(`/${clean}`));
  // Every base that holds it: `src/index.ts` is three files, and the first one found must not decide.
  const based = BASES.map((base) => (base === '' ? clean : `${base}/${clean}`)).filter(exists);
  if (based.length > 0) return based;
  // A path written from inside a source folder (`bracket/format.ts`, `share/cards.ts`): the files that end with it.
  return ALL_FILES.filter((f) => f.endsWith(`/${clean}`));
}
/** A named path's places, every brace alternative of it: empty when ANY alternative is nowhere. */
function resolvePaths(named: string): string[] {
  const each = braces(named).map(placesOf);
  return each.some((places) => places.length === 0) ? [] : each.flat();
}

/** The text the names are looked for in: shipped source, scripts, workflows and the manifests. Never a test. */
const SOURCE_EXT = /\.(ts|tsx|mjs|js|sh|yml|json)$/;
const SOURCE_FILES = ALL_FILES.filter(
  (f) => SOURCE_EXT.test(f) && !/(^|\/)(test|fixtures)\//.test(f) && !f.startsWith('packages/plugin-tests/') && !f.includes('/src/data/'),
);
/** A file's code without its comments: a name that survives only in a comment is not a name the code has. */
const uncommented = (text: string, file: string): string => {
  if (/\.(ts|tsx|mjs|js)$/.test(file)) return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  if (/\.(sh|yml)$/.test(file)) return text.replace(/(^|\s)#.*$/gm, '$1');
  return text;
};
const WORDS_BY_FILE = new Map<string, Set<string>>();
const wordsOf = (file: string): Set<string> => {
  let words = WORDS_BY_FILE.get(file);
  if (!words) {
    words = new Set(uncommented(read(join(ROOT, file)), file).match(/[A-Za-z_$][\w$]*/g) ?? []);
    WORDS_BY_FILE.set(file, words);
  }
  return words;
};
/** Every word of a file, comments included: what a table row about a folder may mention. */
const rawWordsOf = (file: string): Set<string> => new Set(read(join(ROOT, file)).match(/[A-Za-z_$][\w$]*/g) ?? []);
const SOURCE_WORDS = new Set<string>();
for (const f of SOURCE_FILES) for (const w of wordsOf(f)) SOURCE_WORDS.add(w);

/** The scripts of each package.json: the root's under `''`, a workspace package's under its name. */
const PNPM_OWN = new Set(['install', 'audit', 'update', 'exec', 'add', 'dlx', 'pack', 'publish', 'run']);
const SCRIPTS_OF = new Map<string, Set<string>>();
for (const pkg of ['package.json', ...PACKAGE_DIRS.map((d) => `${d}/package.json`)]) {
  if (!TRACKED.has(pkg)) continue;
  const json = JSON.parse(read(join(ROOT, pkg))) as { name?: string; scripts?: Record<string, string> };
  SCRIPTS_OF.set(pkg === 'package.json' ? '' : (json.name ?? pkg), new Set(Object.keys(json.scripts ?? {})));
}
/** Why a `pnpm ...` line cannot run as written, or undefined when its package and its script exist. */
function pnpmProblem(line: string): string | undefined {
  const m = /^pnpm (?:(-r) |-F (\S+) )?(?:run )?([\w:.-]+)/.exec(line);
  if (!m) return undefined;
  const script = m[3] as string;
  // A placeholder (`@claudinho/<pkg>`), a path, a glob or a dependency selector (`...`) is pnpm's to resolve.
  if (m[2] !== undefined && !/^@?[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(m[2])) return undefined;
  const own = m[2] === undefined ? undefined : SCRIPTS_OF.get(m[2]);
  if (m[2] !== undefined && !own) return `no workspace package "${m[2]}"`;
  if (PNPM_OWN.has(script)) return undefined;
  if (own) return own.has(script) ? undefined : `no script "${script}" in ${m[2]}`;
  // `-r` runs in the workspace packages, not in the root.
  if (m[1] !== undefined) return [...SCRIPTS_OF].some(([name, set]) => name !== '' && set.has(script)) ? undefined : `no script "${script}" in any workspace package`;
  return SCRIPTS_OF.get('')?.has(script) ? undefined : `no script "${script}" in the root package.json`;
}

/**
 * Names that are real and are not this repository's tracked source: each with the reason, so an entry is a decision
 * and never a way to silence a rename.
 */
const OUTSIDE: Record<string, string> = {
  // identifiers
  COVERED_ELSEWHERE: "the canary test's own list (packages/core/test/espn-canary.test.ts): a test holds it by design",
  ACCEPTED: "a test's own list of the spellings a competition answers to: a test holds it by design",
  MERGED: 'a pull request state the GitHub CLI prints',
  EXTENDED_GLOB: 'a zsh option the release guide tells the maintainer about',
  CLAUDE_CODE_PLUGIN_DIRS: "an environment variable of Claude Code, the plugin's host",
  NPM_TOKEN: 'the secret the release does NOT use: named to say so',
  additionalProperties: 'a JSON Schema keyword',
  headBranch: 'a field of the GitHub CLI output',
  // paths
  './node_modules/@biomejs/biome/configuration_schema.json': "a file of Biome's installed package",
  'config.json': "the user's saved choice, in the user's config folder",
  'CLAUDE.local.md': "the maintainer's private, untracked file",
  'server/mcp.js': "a file of the MCP SDK's installed package",
  'server/stdio.js': "a file of the MCP SDK's installed package",
  'packages/core/dist': 'a build output, never tracked',
  'packages/notifier': 'a planned package, stated as planned',
  'services/gateway': 'a planned service, stated as planned',
};

const PATH_EXT = /\.(ts|tsx|mjs|js|json|md|sh|yml|mdc)$/;
const PATH_ROOT = /^(packages|scripts|guides|services|\.claude|\.cursor|\.github|core|cli|mcp|src|hooks|types)\//;
const isPath = (t: string) =>
  /^[\w.@/{},*-]+$/.test(t) && !t.startsWith('@') && !t.startsWith('/') && !/^\.[a-z.]+$/.test(t) && (PATH_EXT.test(t) || PATH_ROOT.test(t) || /^\.\.?\//.test(t));
const isIdentifier = (t: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && (/[a-z][A-Z]/.test(t) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(t) || /^[A-Z]{5,}$/.test(t) || /^[a-z]+(_[a-z0-9]+)+$/.test(t));

/** A name given with its file: `name` (`file`...   `name` in `file`   `name` of `file` */
const PAIR = /`([A-Za-z_][A-Za-z0-9_]*)(?:\(\))?`(?: \(| in | of |, in )(?:core |cli |mcp |the |core's |cli's )?`([^`\n]+)`/g;

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
  const path = (t: string) => {
    if (!Object.hasOwn(OUTSIDE, t) && resolvePaths(t).length === 0) findings.push({ kind: 'path', name: t, detail: 'no such tracked file or folder' });
  };
  for (const m of tokens) {
    const raw = m[1] as string;
    const t = raw.replace(/\(\)$/, '');
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (Object.hasOwn(OUTSIDE, t)) continue;
    if (raw.includes(' ')) {
      // A command line: its pnpm script and package, and every word of it that is a path (`bash scripts/gate.sh`).
      // A line that changes folder (`cd packages/mcp && pnpm smoke:stdio`) runs its scripts somewhere this cannot know.
      if (!/(^|\s)cd\s/.test(raw)) {
        for (const part of raw.split(/&&|\|\||[;|]/)) {
          const problem = pnpmProblem(part.trim());
          if (problem !== undefined) findings.push({ kind: 'command', name: raw, detail: problem });
        }
      }
      // The script a command RUNS and the workflow it names; an argument (a destination, a new name) is not a claim.
      for (const m2 of raw.matchAll(/(?:^|\s)(?:bash|sh|node|--workflow)\s+(\S+)/g)) if (isPath(m2[1] as string)) path(m2[1] as string);
    } else if (isPath(t)) path(t);
    else if (isIdentifier(t) && !SOURCE_WORDS.has(t)) findings.push({ kind: 'identifier', name: t, detail: 'in no source, script, workflow or manifest (comments apart)' });
  }
  // A name given with its file: `name` (`file`...   `name` in `file`   `name` of `file`
  for (const m of text.matchAll(PAIR)) {
    const name = m[1] as string;
    const where = m[2] as string;
    if (!isIdentifier(name) || !isPath(where) || Object.hasOwn(OUTSIDE, name) || Object.hasOwn(OUTSIDE, where)) continue;
    const places = resolvePaths(where);
    if (places.length === 0) continue; // reported above as a path
    const files = places.flatMap((place) => (DIRS.has(place) ? ALL_FILES.filter((f) => f.startsWith(`${place}/`) && SOURCE_EXT.test(f)) : [place]));
    if (!files.some((f) => wordsOf(f).has(name))) findings.push({ kind: 'location', name, detail: `not in ${where}` });
  }
  // A table row about ONE place (`| \`packages/core/src/share\` | ... | what it holds |`): a name its last cell gives
  // without a file of its own must be in that place (PR #250: `formatShareBracket` sat in the share folder's row).
  for (const row of text.matchAll(/^\| (`[^|\n]+)\|[^|\n]*\|([^\n]*)\|[ \t]*$/gm)) {
    // The first cell's paths (a row may be about two files); a name the row itself gives a file to is that pair's.
    const cell = [...(row[1] as string).matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string);
    if (cell.length === 0 || !cell.every((c) => isPath(c)) || cell.some((c) => Object.hasOwn(OUTSIDE, c))) continue;
    const places = cell.flatMap(resolvePaths);
    if (places.length === 0) continue; // reported above as a path
    const place = cell.join(' + ');
    const paired = new Set([...(row[2] as string).matchAll(PAIR)].map((m) => m[1] as string));
    const files = places.flatMap((p) => (DIRS.has(p) ? ALL_FILES.filter((f) => f.startsWith(`${p}/`) && SOURCE_EXT.test(f)) : [p]));
    for (const m of (row[2] as string).matchAll(/`([^`\n]+)`/g)) {
      const name = (m[1] as string).replace(/\(\)$/, '');
      if (!isIdentifier(name) || paired.has(name) || Object.hasOwn(OUTSIDE, name)) continue;
      if (!files.some((f) => rawWordsOf(f).has(name))) findings.push({ kind: 'location', name, detail: `not in ${place}, the place its table row is about` });
    }
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
      expect(all.includes(`\`${name}\``), `${name} is named by an instruction file`).toBe(true);
      expect(isIdentifier(name) || isPath(name), `${name} is a form the check reads (else the entry exempts nothing)`).toBe(true);
      if (isIdentifier(name)) expect(SOURCE_WORDS.has(name), `${name} is in the source now: remove it from the list`).toBe(false);
      else expect(resolvePaths(name), `${name} is tracked now: remove it from the list`).toEqual([]);
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

  it('the PR #250 row as main had it: a formatter listed in the row of a folder that does not hold it', () => {
    const was = '| `packages/core/src/share` | — | shareable snippets: the card builders (`cards.ts`) and the formatters (`formatShareSnippet`, `formatShareTable`, `formatShareBracket`); disclaimer non-optional |';
    expect(check(was).map((f) => `${f.kind}:${f.name}`)).toEqual(['location:formatShareBracket']);
    const is = '| `packages/core/src/share` | — | `formatShareSnippet` and `formatShareTable` live here, `formatShareBracket` in `../bracket/format.ts` |';
    expect(check(is)).toEqual([]);
  });

  it('a single-word constant, a command chain and a wrong package for a real script', () => {
    expect(check('one table, `SUPPORTEDD`').map((f) => f.kind)).toEqual(['identifier']);
    expect(check('`DISCLAIMER` (`packages/core/src/supported.ts`)').map((f) => f.kind)).toEqual(['location']);
    expect(check('`SUPPORTED` (`packages/core/src/supported.ts`) and `DISCLAIMER` (`packages/core/src/disclaimer.ts`)')).toEqual([]);
    expect(check('run `pnpm -r build && pnpm removed:script`').map((f) => f.kind)).toEqual(['command']);
    expect(check('run `pnpm -F @claudinho/cli smoke:stdio`').map((f) => f.kind)).toEqual(['command']);
    // A name its file holds only in a comment is not in that file (`stageFromSlug` is defined in trust/espn.ts).
    expect(check('`stageFromSlug` (`packages/core/src/types.ts`)').map((f) => f.kind)).toEqual(['location']);
  });

  it('round 2: a name paired elsewhere in the file, the pnpm package before its command, a pipe, a bare workflow file', () => {
    const row = '| `packages/core/src/share` | — | the card builders and `stageFromSlug` |';
    expect(check(`\`stageFromSlug\` (\`core/src/trust/espn.ts\`) bounds it.\n${row}`).map((f) => `${f.kind}:${f.name}`)).toEqual(['location:stageFromSlug']);
    expect(check('| `.cursor-plugin/plugin.json` + `mcp.json` (repo root) | — | wraps the server (`mcpServers`) |')).toEqual([]);
    expect(check('`pnpm -F @claudinho/gone publish`').map((f) => f.kind)).toEqual(['command']);
    expect(check('`pnpm -r release:qa`').map((f) => f.kind)).toEqual(['command']);
    expect(check('`pnpm -r build | pnpm removed:script`').map((f) => f.kind)).toEqual(['command']);
    expect(check('`gh run list --workflow publish-gone.yml`').map((f) => f.kind)).toEqual(['path']);
    expect(check('`gh run list --workflow publish.yml`')).toEqual([]);
    expect(check('`*.gone.tsx`').map((f) => f.kind)).toEqual(['path']);
  });

  it('only tracked files count: an untracked file in a repository is not one of its files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'instruction-names-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('init', '-q');
      writeFileSync(join(dir, 'tracked.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'untracked.ts'), 'export const b = 1;\n');
      writeFileSync(join(dir, 'gone.ts'), 'export const c = 1;\n');
      git('add', 'tracked.ts', 'gone.ts');
      rmSync(join(dir, 'gone.ts')); // tracked, deleted, not staged
      expect(trackedFiles(dir)).toEqual(['tracked.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('true text stays green: a line that changes folder, a destination, a pnpm selector, a name a folder only mentions', () => {
    expect(check('`cd packages/mcp && pnpm smoke:stdio`')).toEqual([]);
    expect(check('`git worktree add ../claudinho-review HEAD` then `git mv packages/core/src/ahead.ts packages/core/src/next-day.ts`')).toEqual([]);
    expect(check('`pnpm -F ./packages/mcp smoke:stdio`, `pnpm -F "@claudinho/*" build`, `pnpm -F @claudinho/mcp... build`')).toEqual([]);
    expect(check('| `packages/plugin` | — | reads the contract number, core\'s `AMBIENT_API` |')).toEqual([]);
  });

  it('a snake_case name (an MCP tool), and a name whose path is several files', () => {
    expect(check('agents call `get_next_fixtures`').map((f) => f.kind)).toEqual(['identifier']);
    expect(check('agents call `get_next_fixture` and `get_share_snippet`')).toEqual([]);
    // `src/index.ts` is one file per package: core's holds `selectionExtras`, and no order of folders may hide it.
    expect(check('`selectionExtras` (`src/index.ts`)')).toEqual([]);
    expect(check('`selectionExtrasGone` (`src/index.ts`)').map((f) => f.kind)).toEqual(['identifier', 'location']);
  });

  it('a path inside a command line, a brace path and a glob', () => {
    expect(check('run `bash scripts/plugin-test-gone.sh` then `node scripts/verify-gone.mjs --help`').map((f) => f.kind)).toEqual(['path', 'path']);
    expect(check('run `bash scripts/plugin-test.sh` then `node scripts/verify.mjs`')).toEqual([]);
    expect(check('`packages/{cli,mcp}/test/knockout-surface-gone.test.ts`').map((f) => f.kind)).toEqual(['path']);
    expect(check('`packages/{cli,nope}/test/knockout-surface-coverage.test.ts`').map((f) => f.kind)).toEqual(['path']);
    expect(check('`packages/{cli,mcp}/test/knockout-surface-coverage.test.ts` and `packages/plugin-tests/hooks/*.test.tsx`')).toEqual([]);
    expect(check('`packages/plugin-tests/hooks/*.gone.tsx`').map((f) => f.kind)).toEqual(['path']);
  });

  it('a name only a comment holds is not a name the code has', () => {
    expect(uncommented('/** `oldName` did this. */\nexport const newName = 1; // was oldName\n', 'a.ts')).not.toContain('oldName');
    expect(uncommented("const url = 'https://example.test/x'; const kept = 1;\n", 'a.ts')).toContain('kept');
    expect(uncommented('run: echo ok # oldName\n', 'a.yml')).not.toContain('oldName');
  });

  it('a pnpm package that is no workspace package, and a script its package does not have', () => {
    expect(check('run `pnpm -F @claudinho/gone smoke:stdio`').map((f) => f.detail)).toEqual(['no workspace package "@claudinho/gone"']);
    expect(check('run `pnpm -F @claudinho/core smoke:stdio`').map((f) => f.kind)).toEqual(['command']);
    expect(check('run `pnpm -F @claudinho/mcp smoke:stdio`')).toEqual([]);
  });

  it('a pnpm script no package.json has', () => {
    expect(check('run `pnpm release:qa-old`').map((f) => f.kind)).toEqual(['command']);
    expect(check('run `pnpm release:qa`, `pnpm -F @claudinho/core test` and `pnpm -r build`')).toEqual([]);
  });
});

describe('the one count the release steps act on', () => {
  it('the publish workflow has the four jobs AGENTS.md tells the maintainer to watch, by name', () => {
    const yml = read(join(ROOT, '.github/workflows/publish.yml'));
    const jobs = [...yml.slice(yml.indexOf('\njobs:')).matchAll(/^ {2}([A-Za-z_][\w-]*):\s*(?:#.*)?$/gm)].map((m) => m[1]);
    const agents = read(join(ROOT, 'AGENTS.md'));
    expect(agents).toContain('four jobs (`build`, `publish`, `release`, `mcp-registry`)');
    expect(jobs).toEqual(['build', 'publish', 'release', 'mcp-registry']);
  });
});
