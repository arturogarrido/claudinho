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
 * by ONE rule: an allowlist of the exact line shapes the reader reads, and every other non-blank, non-comment line
 * fails, naming the line and the plain form it accepts. The allowlists classify every line where a watched setting
 * can be: pnpm-workspace.yaml's top level (pnpm reads its settings there and nowhere else), and in dependabot.yml the
 * top level, each `updates` entry's keys and its `cooldown:` block. A trailing ` # comment` is accepted on every
 * line; quotes are accepted on a list item and on an ecosystem's name (one anchored expression, with its cases, a
 * `#` inside quotes among them) and refused on a key.
 *
 * Scope, as the pull request states it: this is a structure guard against drift, not a YAML parser. It reads the
 * plain forms these two files use today, and any line it does not read fails. A YAML form built to decode to a
 * watched key while passing that rule is outside the review's model.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** A line that holds nothing: blank, or a comment alone. */
const idle = (l: string) => /^\s*(#.*)?$/.test(l);
const indentOf = (l: string) => /^ */.exec(l)?.[0].length ?? 0;
/** The end every read line may carry: nothing, or a comment after at least one space. */
const END = '(?: +#.*)?$';
/** A scalar, plain (no space, no `#`, no quote) or quoted whole ("…" or '…', a `#` inside allowed). */
const SCALAR = `(?:"([^"]*)"|'([^']*)'|([^\\s#"'\\[\\]{}&*!|>,]+))`;
const scalarOf = (m: RegExpExecArray, at: number) => (m[at] ?? m[at + 1] ?? m[at + 2]) as string;
const unread = (where: string, l: string, forms: string) => `${where} line this test does not read: "${l.trim()}" (the forms it reads: ${forms})`;

// ---- dependabot.yml -------------------------------------------------------------------------------------------

/** Its top-level keys, and each update entry's keys: the ones the file holds today. */
const DEPENDABOT_TOP = /^(version: 2|updates:)(?: +#.*)?$/;
const ECOSYSTEM = new RegExp(`^ {2}- package-ecosystem: ${SCALAR}${END}`);
const ENTRY_KEY = /^ {4}(directory|schedule|open-pull-requests-limit|cooldown|groups|ignore):(?: .*)?$/;
const COOLDOWN = new RegExp(`^ {4}cooldown:${END}`);
const DAYS = new RegExp(`^ {6}(default-days|semver-major-days|semver-minor-days|semver-patch-days): (\\d+)${END}`);
const ENTRY_FORMS = '"    directory: …", "    schedule:", "    open-pull-requests-limit: …", "    cooldown:", "    groups:", "    ignore:"';

/**
 * dependabot.yml's update entries (each ecosystem's name) and every line the allowlists do not read, then every
 * entry whose cooldown does not hold every update it may propose to at least `days`.
 */
function dependabotPolicy(text: string, days: number): { ecosystems: string[]; problems: string[] } {
  const problems: string[] = [];
  const entries: { name: string; keys: Set<string>; cooldown?: Map<string, number> }[] = [];
  let entry: (typeof entries)[number] | undefined;
  let key = ''; // the entry key whose block the deeper lines belong to
  let top = '';
  for (const l of text.split('\n')) {
    if (idle(l)) continue;
    const indent = indentOf(l);
    if (indent === 0) {
      if (!DEPENDABOT_TOP.test(l)) problems.push(unread('a top-level', l, '"version: 2", "updates:"'));
      top = DEPENDABOT_TOP.test(l) ? l.replace(/:.*$/, '') : '';
      entry = undefined;
      continue;
    }
    if (top !== 'updates') {
      problems.push(unread('an indented', l, 'an update entry under "updates:"'));
      continue;
    }
    if (indent === 2) {
      const m = ECOSYSTEM.exec(l);
      entry = undefined;
      key = '';
      if (!m) {
        problems.push(unread('an update entry', l, '"  - package-ecosystem: npm"'));
        continue;
      }
      entry = { name: scalarOf(m, 1), keys: new Set() };
      entries.push(entry);
      continue;
    }
    if (!entry) {
      problems.push(unread('an entry', l, 'a key under "  - package-ecosystem: …"'));
      continue;
    }
    if (indent === 4) {
      const m = ENTRY_KEY.exec(l);
      if (!m) {
        problems.push(unread('an entry', l, ENTRY_FORMS));
        key = '';
        continue;
      }
      key = m[1] as string;
      if (entry.keys.has(key)) problems.push(`${entry.name}: ${key} is set twice: "${l.trim()}"`);
      entry.keys.add(key);
      if (key === 'cooldown') {
        if (!COOLDOWN.test(l)) problems.push(unread('a cooldown', l, '"    cooldown:"'));
        entry.cooldown ??= new Map();
      }
      continue;
    }
    if (indent < 4) {
      problems.push(unread('an entry', l, `a key at four spaces (${ENTRY_FORMS}), or its block below it`));
      continue;
    }
    if (key !== 'cooldown') continue; // a block of another entry key: not a watched setting
    const m = DAYS.exec(l);
    if (!m) {
      problems.push(unread('a cooldown', l, '"      default-days: 7", "      semver-patch-days: 7"; an include or exclude list takes dependencies out of the wait'));
      continue;
    }
    entry.cooldown?.set(m[1] as string, Number(m[2]));
  }
  for (const e of entries) {
    if (!e.cooldown) {
      problems.push(`${e.name}: no cooldown (the form it reads: "    cooldown:" then "      default-days: 7")`);
      continue;
    }
    if (!e.cooldown.has('default-days')) problems.push(`${e.name}: cooldown.default-days is not set`);
    for (const [k, n] of e.cooldown) if (n < days) problems.push(`${e.name}: cooldown.${k} is ${n} days, shorter than pnpm's minimum age of ${days}`);
  }
  return { ecosystems: entries.map((e) => e.name), problems };
}

// ---- pnpm-workspace.yaml --------------------------------------------------------------------------------------

/** Its top-level keys: the ones the file holds today, and `overrides`. */
const WORKSPACE_TOP = /^(packages|allowBuilds|verifyDepsBeforeRun|overrides|minimumReleaseAge|minimumReleaseAgeExclude):(?: .*)?$/;
const AGE = new RegExp(`^minimumReleaseAge: (\\d+)${END}`);
const EXCLUDE_KEY = new RegExp(`^minimumReleaseAgeExclude:${END}`);
const EXCLUDE_EMPTY = new RegExp(`^minimumReleaseAgeExclude: \\[\\]${END}`);
const ITEM = new RegExp(`^ *- ${SCALAR}${END}`);
const TOP_FORMS =
  '"packages:", "allowBuilds:", "verifyDepsBeforeRun: …", "overrides:", "minimumReleaseAge: 10080", "minimumReleaseAgeExclude:" then "  - name@1.2.3", "minimumReleaseAgeExclude: []"';

/**
 * pnpm-workspace.yaml's age policy: the minimum age in minutes (read at column 0), the exception list's entries,
 * and every line the allowlists do not read: any top-level line that is not a known plain key (a quoted, escaped
 * or tagged key, an explicit `?` key, a flow mapping, `---`, an unknown setting), an indented line before any key,
 * a key set twice, and any line of the exception list that is not an item.
 */
function agePolicy(text: string): { age?: number; exclude: string[]; problems: string[] } {
  const problems: string[] = [];
  const exclude: string[] = [];
  const seen = new Set<string>();
  let age: number | undefined;
  let key = '';
  for (const l of text.split('\n')) {
    if (idle(l)) continue;
    const item = /^- /.test(l);
    if (item && key && key !== 'minimumReleaseAgeExclude') continue; // a column-0 item of the key above
    if (/^\S/.test(l) && !(item && key === 'minimumReleaseAgeExclude')) {
      const m = WORKSPACE_TOP.exec(l);
      if (!m) {
        problems.push(unread('a top-level', l, TOP_FORMS));
        key = '';
        continue;
      }
      key = m[1] as string;
      if (seen.has(key)) problems.push(`${key} is set twice: "${l.trim()}"`);
      seen.add(key);
      if (key === 'minimumReleaseAge') {
        const a = AGE.exec(l);
        if (a) age = Number(a[1]);
        else problems.push(unread('an age', l, '"minimumReleaseAge: 10080"'));
      } else if (key === 'minimumReleaseAgeExclude' && !EXCLUDE_KEY.test(l) && !EXCLUDE_EMPTY.test(l)) {
        problems.push(unread('an exception', l, '"minimumReleaseAgeExclude:" then "  - name@1.2.3", "minimumReleaseAgeExclude: []"'));
      }
      continue;
    }
    if (!key) {
      problems.push(unread('an indented', l, `a top-level key first: ${TOP_FORMS}`));
      continue;
    }
    if (key !== 'minimumReleaseAgeExclude') continue; // a block of another key: not a watched setting
    const m = ITEM.exec(l);
    if (m) exclude.push(scalarOf(m, 1));
    else problems.push(unread('an exception', l, '"  - name@1.2.3"'));
  }
  return { age, exclude, problems };
}

/** One exact version of one package: `name@1.2.3` or `@scope/name@1.2.3` (a prerelease or build tag allowed). */
const EXACT = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const MINUTES_PER_DAY = 24 * 60;

describe('the dependency age policy', () => {
  const policy = agePolicy(read('pnpm-workspace.yaml'));

  it('pnpm refuses a version younger than seven days (minimumReleaseAge, in minutes, at the top level), in a form this test reads', () => {
    expect(policy.problems).toEqual([]);
    expect(policy.age, 'minimumReleaseAge at column 0 of pnpm-workspace.yaml').toBeDefined();
    expect(policy.age).toBeGreaterThanOrEqual(7 * MINUTES_PER_DAY);
  });

  it("every Dependabot ecosystem holds every update it may propose for at least pnpm's minimum age", () => {
    const days = Math.ceil((policy.age ?? Number.POSITIVE_INFINITY) / MINUTES_PER_DAY);
    const { ecosystems, problems } = dependabotPolicy(read('.github/dependabot.yml'), days);
    expect(problems).toEqual([]);
    expect([...ecosystems].sort()).toEqual(['github-actions', 'npm']);
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
    // A block list at the key's own indent is valid YAML, and is read; so is one under another key.
    expect(ws('minimumReleaseAgeExclude:\n- vite')).toEqual({ age: undefined, exclude: ['vite'], problems: [] });
    expect(agePolicy('packages:\n- "packages/*"\nminimumReleaseAge: 10080\n')).toEqual({ age: 10080, exclude: [], problems: [] });
    // A `#` inside quotes is part of the value, not a comment.
    expect(ws('minimumReleaseAgeExclude:\n  - "a#b@1.0.0" # why').exclude).toEqual(['a#b@1.0.0']);
    // A comment that names a watched key, on a line of its own or after another key, is a comment.
    expect(ws('# add exact versions to minimumReleaseAgeExclude here').problems).toEqual([]);
    expect(ws('verifyDepsBeforeRun: false # see minimumReleaseAge').problems).toEqual([]);
  });

  it('fail every other top-level form, naming it', () => {
    const refused = [
      '"minimumRelease\\u0041geExclude": [vite]',
      '"minimumReleaseAgeExclude": [vite]',
      "'minimumReleaseAge': 10080",
      '!!str minimumReleaseAgeExclude: [vite]',
      '? minimumReleaseAgeExclude\n: [vite]',
      '{ minimumReleaseAgeExclude: [vite] }',
      '---\nminimumReleaseAge: 10080',
      'minimumReleaseAgeStrict: false',
      'minimumReleaseAgeExcludePrune: true',
      'settings:\n  minimumReleaseAgeExclude:\n    - vite',
      'minimumReleaseAgeExclude: [vite]',
      'minimumReleaseAgeExclude: vite',
      'minimumReleaseAgeExclude: [\n  vite\n]',
      'minimumReleaseAgeExclude: &x\n  - vite',
      'minimumReleaseAgeExclude:\n  - vite\n    continued',
      'minimumReleaseAgeExclude:\n  - [vite]',
      'minimumReleaseAge: "10080"',
      'minimumReleaseAge: 10080\nminimumReleaseAge: 1440',
      'minimumReleaseAge: 10080# no space before the comment',
    ];
    for (const body of refused) expect(ws(body).problems, body).not.toEqual([]);
    expect(ws('"minimumRelease\\u0041geExclude": [vite]').problems[0]).toMatch(
      /^a top-level line this test does not read: ""minimumRelease\\u0041geExclude": \[vite\]" \(the forms it reads: "packages:"/,
    );
  });

  it('fail a file whose root mapping is indented: the age is read at column 0 only', () => {
    const indented = agePolicy('  packages:\n    - "packages/*"\n  minimumReleaseAge: 10080\n');
    expect(indented.age).toBeUndefined();
    expect(indented.problems).not.toEqual([]);
  });

  it('hold a bare name, a pattern or a range to be refused, and one exact version to be accepted', () => {
    for (const ok of ['vite@6.4.5', '@scope/pkg@1.0.0-rc.1', 'esbuild@0.28.2']) expect(ok).toMatch(EXACT);
    for (const bad of ['vite', '@scope/*', '@scope/pkg', 'vite@^6.4.5', 'vite@6', 'vite@6.4.5 || 6.4.6', 'vite@*', '*', 'a#b@1.0.0'])
      expect(bad, bad).not.toMatch(EXACT);
  });

  const dep = (cooldown: string, name = 'npm', extra = '') =>
    `version: 2\nupdates:\n  - package-ecosystem: ${name}\n    directory: "/" # package-ecosystem root\n    schedule:\n      interval: weekly\n${cooldown}    groups:\n      dev:\n        dependency-type: development\n${extra}`;
  const COOL = '    cooldown:\n      default-days: 7\n';

  it('read an ecosystem name plain or quoted, and a cooldown of days keys, with comments that name watched keys', () => {
    expect(dependabotPolicy(dep(COOL), 7)).toEqual({ ecosystems: ['npm'], problems: [] });
    expect(dependabotPolicy(dep(COOL, '"npm" # npm and pnpm'), 7).ecosystems).toEqual(['npm']);
    expect(dependabotPolicy(dep(COOL, "'github-actions'"), 7)).toEqual({ ecosystems: ['github-actions'], problems: [] });
    expect(dependabotPolicy(dep('    cooldown: # the wait\n      # seven days\n      default-days: 7 # cooldown in days\n      semver-major-days: 30\n'), 7).problems).toEqual([]);
  });

  it('fail a cooldown that shortens or skips the wait, and every line the allowlists do not read', () => {
    const refused = {
      'no cooldown': dep(''),
      'a shorter default': dep('    cooldown:\n      default-days: 3\n'),
      'a shorter patch wait': dep(`${COOL}      semver-patch-days: 1\n`),
      'an exclude list': dep(`${COOL}      exclude:\n        - "*"\n`),
      'an include list': dep(`${COOL}      include: ["vite"]\n`),
      'no default': dep('    cooldown:\n      semver-major-days: 30\n'),
      'a key that is not a days key': dep(`${COOL}      semver-build-days: 30\n`),
      'a flow mapping': dep('    cooldown: { default-days: 7 }\n'),
      'a quoted days key': dep('    cooldown:\n      "default-days": 7\n'),
      'a quoted value': dep('    cooldown:\n      default-days: "7"\n'),
      'a value that is not a number': dep('    cooldown:\n      default-days: seven\n'),
      'a second cooldown': dep(`${COOL}    cooldown:\n      default-days: 1\n`),
      'a second, empty cooldown (a loader keeping the last key would read none)': dep(`${COOL}    cooldown:\n`),
      'a second, escaped cooldown': dep(`${COOL}    "cool\\u0064own":\n      default-days: 1\n`),
      'an escaped days key at entry level': dep(`${COOL}    "default-d\\u0061ys": 1\n`),
      'a flow mapping at entry level': dep(`${COOL}    { default-days: 1 }\n`),
      'an unknown entry key': dep(`${COOL}    registries: "*"\n`),
      'a line at three spaces': dep(`${COOL}   default-days: 1\n`),
      'a quoted ecosystem key': 'version: 2\nupdates:\n  - "package-ecosystem": npm\n    cooldown:\n      default-days: 7\n',
      'a flow entry': 'version: 2\nupdates:\n  - { package-ecosystem: npm, cooldown: { default-days: 1 } }\n',
      'an unknown top-level key': dep(COOL, 'npm', 'registries:\n  npm: {}\n'),
      'a second document': dep(COOL, 'npm', '---\nversion: 2\n'),
    };
    for (const [why, text] of Object.entries(refused)) expect(dependabotPolicy(text, 7).problems, why).not.toEqual([]);
    expect(dependabotPolicy(dep(`${COOL}    "cool\\u0064own":\n      default-days: 1\n`), 7).problems[0]).toMatch(
      /^an entry line this test does not read: ""cool\\u0064own":" \(the forms it reads: " {4}directory: …"/,
    );
  });
});
