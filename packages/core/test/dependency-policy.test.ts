/**
 * The dependency age policy: a newly published version is adopted only after it has aged, on both paths that
 * adopt one. Dependabot waits (`cooldown`, in days) before it proposes a version update, and pnpm refuses to
 * resolve, or to install from the lockfile, a version younger than `minimumReleaseAge` (in minutes; measured on
 * pnpm 11.28.8: `pnpm install --frozen-lockfile` fails with ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION on a lockfile
 * entry younger than the setting).
 *
 * Two invariants follow. Dependabot's wait is at least pnpm's, or a version update Dependabot is allowed to open
 * fails CI's install. And an exception to pnpm's rule names one exact version: a bare package name (or a pattern,
 * or a range) exempts every future version of that package, which is the rule switched off for it.
 *
 * Both files are read as text, line by line, the way the workflow tests read their YAML.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const dependabot = read('.github/dependabot.yml');
const workspace = read('pnpm-workspace.yaml');

/** Each `- package-ecosystem:` entry of dependabot.yml: its ecosystem and its own text, up to the next entry. */
function ecosystems(text: string): { name: string; text: string }[] {
  const at = [...text.matchAll(/^ {2}- package-ecosystem: *(\S+)\s*$/gm)];
  return at.map((m, i) => ({ name: m[1] as string, text: text.slice(m.index, at[i + 1]?.index ?? text.length) }));
}

/** An entry's `cooldown.default-days`, or undefined when it has none. */
function cooldownDays(entry: string): number | undefined {
  const block = /^ {4}cooldown:\s*\n((?: {6}.*\n?)+)/m.exec(entry)?.[1];
  const days = block && /^ {6}default-days: *(\d+)\s*$/m.exec(block)?.[1];
  return days ? Number(days) : undefined;
}

/** The top-level `minimumReleaseAge` of pnpm-workspace.yaml, in minutes, or undefined. */
function minimumReleaseAge(text: string): number | undefined {
  const m = /^minimumReleaseAge: *(\d+)\s*(#.*)?$/m.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** The entries of the top-level `minimumReleaseAgeExclude` list, unquoted; [] when the key is absent. */
function excludeEntries(text: string): string[] {
  const m = /^minimumReleaseAgeExclude:[ \t]*(.*)\n((?:(?:[ \t]+.*|[ \t]*#.*|)\n)*)/m.exec(`${text}\n`);
  if (!m) return [];
  const inline = (m[1] ?? '').replace(/#.*$/, '').trim();
  // A flow sequence (`[a, b]`) or a scalar on the key's line is still a list someone wrote: read it, so the rule
  // below sees it (the empty flow list `[]` holds nothing).
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  return (m[2] ?? '')
    .split('\n')
    .map((l) => /^[ \t]+-[ \t]*(.*?)[ \t]*(#.*)?$/.exec(l)?.[1])
    .filter((v): v is string => v !== undefined)
    .map((v) => v.replace(/^["']|["']$/g, ''));
}

/** One exact version of one package: `name@1.2.3` or `@scope/name@1.2.3` (a prerelease or build tag allowed). */
const EXACT = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

describe('the dependency age policy', () => {
  it('pnpm refuses a version younger than seven days (minimumReleaseAge, in minutes)', () => {
    const age = minimumReleaseAge(workspace);
    expect(age, 'minimumReleaseAge in pnpm-workspace.yaml').toBeDefined();
    expect(age).toBeGreaterThanOrEqual(7 * 24 * 60);
  });

  it("every Dependabot ecosystem waits at least as long as pnpm's minimum age", () => {
    const age = minimumReleaseAge(workspace) ?? Number.POSITIVE_INFINITY;
    const all = ecosystems(dependabot);
    expect(all.map((e) => e.name).sort()).toEqual(['github-actions', 'npm']);
    for (const e of all) {
      const days = cooldownDays(e.text);
      expect(days, `${e.name}: cooldown.default-days`).toBeDefined();
      expect((days as number) * 24 * 60, `${e.name}: its cooldown is shorter than pnpm's minimumReleaseAge`).toBeGreaterThanOrEqual(age);
    }
  });

  it('every exception to the minimum age names one exact version', () => {
    for (const entry of excludeEntries(workspace)) expect(entry, 'minimumReleaseAgeExclude takes name@version only').toMatch(EXACT);
  });

  it("the exception reader reads a list's every form, and the rule refuses what exempts more than one version", () => {
    const list = (body: string) => excludeEntries(`packages:\n  - "packages/*"\n${body}\nallowBuilds:\n  esbuild: false\n`);
    expect(list('')).toEqual([]);
    expect(list('minimumReleaseAgeExclude: []')).toEqual([]);
    expect(list('minimumReleaseAgeExclude:\n  - "vite@6.4.5" # GHSA-xxxx, Nov 11\n  - \'@scope/pkg@1.0.0-rc.1\'\n  - esbuild@0.28.2')).toEqual([
      'vite@6.4.5',
      '@scope/pkg@1.0.0-rc.1',
      'esbuild@0.28.2',
    ]);
    expect(list('minimumReleaseAgeExclude: [vite, "esbuild@0.28.2"]')).toEqual(['vite', 'esbuild@0.28.2']);
    for (const ok of ['vite@6.4.5', '@scope/pkg@1.0.0-rc.1', 'esbuild@0.28.2']) expect(ok).toMatch(EXACT);
    for (const bad of ['vite', '@scope/*', '@scope/pkg', 'vite@^6.4.5', 'vite@6', 'vite@6.4.5 || 6.4.6', 'vite@*', '*'])
      expect(bad, bad).not.toMatch(EXACT);
  });
});
