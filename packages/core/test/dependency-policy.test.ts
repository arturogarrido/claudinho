/**
 * The dependency age policy: a newly published version is adopted only after it has aged, on both paths that
 * adopt one. Dependabot waits (`cooldown`, in days) before it proposes a version update, and pnpm refuses to
 * resolve, or to install from the lockfile, a version younger than `minimumReleaseAge` (in minutes; measured on
 * pnpm 11.28.8: `pnpm install --frozen-lockfile` fails with ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION on a lockfile
 * entry younger than the setting).
 *
 * Two invariants follow. Dependabot's wait is at least pnpm's for every update it may propose (no shorter
 * per-semver wait, no `include`/`exclude` list taking dependencies out of it), or a version update Dependabot is
 * allowed to open fails CI's install. And an exception to pnpm's rule names one exact version: a bare package name
 * (or a pattern, or a range) exempts every future version of that package, which is the rule switched off for it.
 *
 * Both files are read as text, line by line, the way the workflow tripwires read their YAML (no YAML dependency),
 * by ONE rule: each reader has an allowlist of the exact line shapes it reads, and every other non-blank,
 * non-comment line inside the block it guards (an ecosystem's `cooldown:` block; any line naming a
 * `minimumReleaseAge*` key, and the exception list's items) fails, naming the line and the plain form it accepts.
 * A trailing ` # comment` is accepted on every read line; quotes are accepted on a list item and on an ecosystem's
 * name (each one anchored expression, with its cases below, a `#` inside quotes among them) and refused on a key.
 * Limit, in the rule table's words: it reads the plain forms; any other form fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const dependabot = read('.github/dependabot.yml');
const workspace = read('pnpm-workspace.yaml');

/** A line that holds nothing: blank, or a comment alone. */
const idle = (l: string) => /^\s*(#.*)?$/.test(l);
/** The end every read line may carry: nothing, or a comment after at least one space. */
const END = '(?: +#.*)?$';
/** A scalar, plain (no space, no `#`, no quote) or quoted whole ("…" or '…', a `#` inside allowed). */
const SCALAR = `(?:"([^"]*)"|'([^']*)'|([^\\s#"'\\[\\]{}&*!|>,]+))`;
const scalarOf = (m: RegExpExecArray, at: number) => (m[at] ?? m[at + 1] ?? m[at + 2]) as string;

const ECOSYSTEM = new RegExp(`^ {2}- package-ecosystem: ${SCALAR}${END}`);
const COOLDOWN = new RegExp(`^ {4}cooldown:${END}`);
const DAYS = new RegExp(`^ {6}(default-days|semver-major-days|semver-minor-days|semver-patch-days): (\\d+)${END}`);

/** Each `- package-ecosystem:` entry of dependabot.yml (its name and its own text), and every line naming the key it could not read. */
function ecosystems(text: string): { entries: { name: string; text: string }[]; problems: string[] } {
  const lines = text.split('\n');
  const problems: string[] = [];
  const starts: { at: number; name: string }[] = [];
  lines.forEach((l, i) => {
    if (idle(l) || !/package-ecosystem/.test(l)) return;
    const m = ECOSYSTEM.exec(l);
    if (m) starts.push({ at: i, name: scalarOf(m, 1) });
    else problems.push(`an ecosystem line this test does not read: "${l.trim()}" (the form it reads: "  - package-ecosystem: npm")`);
  });
  const entries = starts.map((s, i) => ({ name: s.name, text: lines.slice(s.at, starts[i + 1]?.at ?? lines.length).join('\n') }));
  return { entries, problems };
}

/** Why an entry's cooldown does not hold every update it may propose to at least `days`; [] when it does. */
function cooldownProblems(entry: string, days: number): string[] {
  const lines = entry.split('\n');
  const mentions = lines.flatMap((l, i) => (!idle(l) && /cooldown/.test(l) ? [i] : []));
  if (mentions.length === 0) return ['no cooldown (the form it reads: "    cooldown:" then "      default-days: 7")'];
  const problems: string[] = [];
  const head = mentions[0] as number;
  if (mentions.length > 1 || !COOLDOWN.test(lines[head] as string)) {
    for (const i of mentions)
      if (i !== head || !COOLDOWN.test(lines[i] as string))
        problems.push(`a cooldown line this test does not read: "${(lines[i] as string).trim()}" (the form it reads: "    cooldown:")`);
    if (problems.length) return problems;
  }
  let sawDefault = false;
  for (const l of lines.slice(head + 1)) {
    if (idle(l)) continue;
    if (!/^ {5}/.test(l)) break; // back at the entry's own keys: the block has ended
    const m = DAYS.exec(l);
    if (!m) {
      problems.push(`a cooldown line this test does not read: "${l.trim()}" (the forms it reads: "      default-days: 7", "      semver-patch-days: 7"; an include or exclude list takes dependencies out of the wait)`);
      continue;
    }
    if (m[1] === 'default-days') sawDefault = true;
    if (Number(m[2]) < days) problems.push(`cooldown.${m[1]} is ${m[2]} days, shorter than pnpm's minimum age of ${days}`);
  }
  if (!sawDefault) problems.push('cooldown.default-days is not set');
  return problems;
}

const AGE = new RegExp(`^minimumReleaseAge: (\\d+)${END}`);
const EXCLUDE_KEY = new RegExp(`^minimumReleaseAgeExclude:${END}`);
const EXCLUDE_EMPTY = new RegExp(`^minimumReleaseAgeExclude: \\[\\]${END}`);
const ITEM = new RegExp(`^\\s*- ${SCALAR}${END}`);

/**
 * pnpm-workspace.yaml's age policy: the minimum age in minutes, the exception list's entries, and every line naming
 * a `minimumReleaseAge*` key (or inside the exception list) that is not one of the forms read.
 */
function agePolicy(text: string): { age?: number; exclude: string[]; problems: string[] } {
  const lines = text.split('\n');
  const problems: string[] = [];
  const exclude: string[] = [];
  let age: number | undefined;
  const form = '"minimumReleaseAge: 10080", "minimumReleaseAgeExclude:" then "  - name@1.2.3", "minimumReleaseAgeExclude: []"';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (idle(l) || !/minimumReleaseAge/.test(l)) continue;
    const a = AGE.exec(l);
    if (a) {
      if (age !== undefined) problems.push(`minimumReleaseAge is set twice: "${l.trim()}"`);
      age = Number(a[1]);
      continue;
    }
    if (EXCLUDE_EMPTY.test(l)) continue;
    if (EXCLUDE_KEY.test(l)) {
      for (i++; i < lines.length; i++) {
        const item = lines[i] as string;
        if (idle(item)) continue;
        const m = ITEM.exec(item);
        if (m) {
          exclude.push(scalarOf(m, 1));
          continue;
        }
        if (/^\S/.test(item) && !/^-/.test(item)) {
          i--; // the next top-level key: the list has ended, and the outer loop reads this line
          break;
        }
        problems.push(`an exception line this test does not read: "${item.trim()}" (the form it reads: "  - name@1.2.3")`);
      }
      continue;
    }
    problems.push(`an age-policy line this test does not read: "${l.trim()}" (the forms it reads: ${form})`);
  }
  return { age, exclude, problems };
}

/** One exact version of one package: `name@1.2.3` or `@scope/name@1.2.3` (a prerelease or build tag allowed). */
const EXACT = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const MINUTES_PER_DAY = 24 * 60;

describe('the dependency age policy', () => {
  const policy = agePolicy(workspace);

  it('pnpm refuses a version younger than seven days (minimumReleaseAge, in minutes), in a form this test reads', () => {
    expect(policy.problems).toEqual([]);
    expect(policy.age, 'minimumReleaseAge in pnpm-workspace.yaml').toBeDefined();
    expect(policy.age).toBeGreaterThanOrEqual(7 * MINUTES_PER_DAY);
  });

  it("every Dependabot ecosystem holds every update it may propose for at least pnpm's minimum age", () => {
    const days = Math.ceil((policy.age ?? Number.POSITIVE_INFINITY) / MINUTES_PER_DAY);
    const { entries, problems } = ecosystems(dependabot);
    expect(problems).toEqual([]);
    expect(entries.map((e) => e.name).sort()).toEqual(['github-actions', 'npm']);
    for (const e of entries) expect(cooldownProblems(e.text, days), e.name).toEqual([]);
  });

  it('every exception to the minimum age names one exact version', () => {
    for (const entry of policy.exclude) expect(entry, 'minimumReleaseAgeExclude takes name@version only').toMatch(EXACT);
  });
});

describe('the policy readers: the plain forms are read, any other form fails', () => {
  const ws = (body: string) => agePolicy(`packages:\n  - "packages/*"\n${body}\nallowBuilds:\n  esbuild: false\n`);

  it('read the age, and the exception list at any indent, quoted or plain, with trailing comments', () => {
    expect(ws('minimumReleaseAge: 10080 # seven days')).toEqual({ age: 10080, exclude: [], problems: [] });
    expect(ws('')).toEqual({ age: undefined, exclude: [], problems: [] });
    expect(ws('minimumReleaseAgeExclude: [] # none')).toEqual({ age: undefined, exclude: [], problems: [] });
    expect(ws('minimumReleaseAgeExclude:\n  - "vite@6.4.5" # GHSA-xxxx, Nov 11\n  # a comment line\n  - \'@scope/pkg@1.0.0-rc.1\'\n  - esbuild@0.28.2').exclude).toEqual([
      'vite@6.4.5',
      '@scope/pkg@1.0.0-rc.1',
      'esbuild@0.28.2',
    ]);
    // A block list at the key's own indent is valid YAML, and is read.
    expect(ws('minimumReleaseAgeExclude:\n- vite')).toEqual({ age: undefined, exclude: ['vite'], problems: [] });
    // A `#` inside quotes is part of the value, not a comment.
    expect(ws('minimumReleaseAgeExclude:\n  - "a#b@1.0.0" # why').exclude).toEqual(['a#b@1.0.0']);
    // A comment that only names the key is not the key.
    expect(ws('# add exact versions to minimumReleaseAgeExclude here').problems).toEqual([]);
  });

  it('fail every other form of an age-policy line, naming it', () => {
    const refused = [
      '"minimumReleaseAgeExclude": [vite]',
      "'minimumReleaseAge': 10080",
      'minimumReleaseAgeExclude: [vite]',
      'minimumReleaseAgeExclude: vite',
      'minimumReleaseAgeExclude: [\n  vite\n]',
      'minimumReleaseAgeExclude: &x\n  - vite',
      'minimumReleaseAge: "10080"',
      'minimumReleaseAge: 10080\nminimumReleaseAge: 1440',
      'settings:\n  minimumReleaseAgeExclude:\n    - vite',
      'minimumReleaseAgeExclude:\n  - vite\n    continued',
      'minimumReleaseAgeExclude:\n  - [vite]',
      'minimumReleaseAgeStrict: false',
      'minimumReleaseAgeExcludePrune: true',
      'minimumReleaseAge: 10080# no space before the comment',
    ];
    for (const body of refused) expect(ws(body).problems, body).not.toEqual([]);
    expect(ws('"minimumReleaseAgeExclude": [vite]').problems[0]).toMatch(/does not read: ""minimumReleaseAgeExclude": \[vite\]" \(the forms it reads: /);
  });

  it('hold a bare name, a pattern or a range to be refused, and one exact version to be accepted', () => {
    for (const ok of ['vite@6.4.5', '@scope/pkg@1.0.0-rc.1', 'esbuild@0.28.2']) expect(ok).toMatch(EXACT);
    for (const bad of ['vite', '@scope/*', '@scope/pkg', 'vite@^6.4.5', 'vite@6', 'vite@6.4.5 || 6.4.6', 'vite@*', '*', 'a#b@1.0.0'])
      expect(bad, bad).not.toMatch(EXACT);
  });

  const entry = (cooldown: string, name = 'npm') =>
    `  - package-ecosystem: ${name}\n    directory: "/"\n    schedule:\n      interval: weekly\n${cooldown}    groups:\n      dev:\n        dependency-type: development\n`;

  it('read an ecosystem name plain or quoted, with a trailing comment, and fail any other form of the line', () => {
    expect(ecosystems(entry('', 'npm')).entries.map((e) => e.name)).toEqual(['npm']);
    expect(ecosystems(entry('', '"npm" # npm and pnpm')).entries.map((e) => e.name)).toEqual(['npm']);
    expect(ecosystems(entry('', "'github-actions'")).entries.map((e) => e.name)).toEqual(['github-actions']);
    expect(ecosystems('updates:\n  - "package-ecosystem": npm\n').problems).not.toEqual([]);
    expect(ecosystems('updates:\n  - { package-ecosystem: npm }\n').problems).not.toEqual([]);
  });

  it('read a cooldown of days keys with comments, each at least the age', () => {
    expect(cooldownProblems(entry('    cooldown:\n      default-days: 7\n'), 7)).toEqual([]);
    expect(cooldownProblems(entry('    cooldown: # the wait\n      # seven days\n      default-days: 7 # days\n      semver-major-days: 30\n'), 7)).toEqual([]);
  });

  it('fail a cooldown that shortens or skips the wait, or that is written in a form it does not read', () => {
    const refused = {
      'no cooldown': '',
      'a shorter default': '    cooldown:\n      default-days: 3\n',
      'a shorter patch wait': '    cooldown:\n      default-days: 7\n      semver-patch-days: 1\n',
      'an exclude list': '    cooldown:\n      default-days: 7\n      exclude:\n        - "*"\n',
      'an include list': '    cooldown:\n      default-days: 7\n      include: ["vite"]\n',
      'no default': '    cooldown:\n      semver-major-days: 30\n',
      'a flow mapping': '    cooldown: { default-days: 7 }\n',
      'a quoted key': '    cooldown:\n      "default-days": 7\n',
      'a quoted value': '    cooldown:\n      default-days: "7"\n',
      'a value that is not a number': '    cooldown:\n      default-days: seven\n',
      'a key that is not a days key': '    cooldown:\n      default-days: 7\n      semver-build-days: 30\n',
      'a second cooldown': '    cooldown:\n      default-days: 7\n    cooldown:\n      default-days: 1\n',
    };
    for (const [why, block] of Object.entries(refused)) expect(cooldownProblems(entry(block), 7), why).not.toEqual([]);
    expect(cooldownProblems(entry('    cooldown:\n      default-days: 7\n      exclude:\n        - "*"\n'), 7)[0]).toMatch(
      /does not read: "exclude:" \(the forms it reads: " {6}default-days: 7"/,
    );
  });
});
