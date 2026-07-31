import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `biome.json` lives at the REPO ROOT and points `$schema` at the schema shipped
 * INSIDE the installed package (`./node_modules/@biomejs/biome/configuration_schema.json`)
 * rather than at a version-pinned `https://biomejs.dev/schemas/<version>/schema.json`.
 *
 * Why: Dependabot only ever bumps `@biomejs/biome` in the root `package.json` — it
 * never touches biome.json — so a version-pinned URL drifts on EVERY bump, and Biome
 * then reports a schema-version mismatch on every lint run. That happened on six
 * consecutive bumps (2.5.0 / 2.5.1 / 2.5.3 landed mismatched on main; 2.5.2 / 2.5.4 /
 * 2.5.5 were caught and hand-patched on the PR branch first).
 *
 * The relative path makes drift STRUCTURALLY IMPOSSIBLE: it resolves to whatever
 * version is installed, so it is correct by construction after any bump — no edit,
 * no guard to satisfy, nothing to forget. Editors (VS Code / Cursor) resolve a
 * relative `$schema` against the config file's own directory, so completions keep
 * working.
 *
 * What Biome does with the value (measured, not assumed): it READS it and, when the
 * value is a versioned `biomejs.dev` URL, compares that version against its own —
 * that is the "configuration schema version does not match the CLI version" info
 * diagnostic the old scheme emitted on every lint run. It does NOT dereference or
 * fetch the value: pointing `$schema` at a path that does not exist produces no
 * diagnostic at all. Hence both properties we want — a relative path gives Biome no
 * version to compare (the mismatch class disappears), and a not-yet-installed
 * node_modules lints cleanly in a fresh clone.
 *
 * These assertions therefore guard the SHAPE, not a version: nobody should quietly
 * reintroduce a pinned URL (that restores the drift class), and the file the path
 * names must actually exist (a Biome major could rename or relocate it — the one way
 * this scheme can still break, and, per the measurement above, it would fail SILENTLY:
 * Biome says nothing, so only an editor losing completions would ever reveal it).
 */
const ROOT = '../../../';
const readRoot = (rel: string) =>
  JSON.parse(readFileSync(new URL(`${ROOT}${rel}`, import.meta.url), 'utf8'));

/** Expected value — one constant so the assertions and the failure text can't disagree. */
const RELATIVE_SCHEMA = './node_modules/@biomejs/biome/configuration_schema.json';

describe('biome.json $schema is install-relative, so it cannot drift', () => {
  const biomeConfig = readRoot('biome.json') as { $schema?: string };
  const rootPkg = readRoot('package.json') as { devDependencies?: Record<string, string> };

  it('root package.json still declares @biomejs/biome', () => {
    expect(rootPkg.devDependencies?.['@biomejs/biome']).toBeTruthy();
  });

  it('$schema points into node_modules, NOT at a version-pinned URL', () => {
    expect(
      biomeConfig.$schema,
      'biome.json $schema must stay install-relative. A versioned ' +
        'https://biomejs.dev/schemas/<version>/schema.json URL reintroduces the drift ' +
        'class: Dependabot bumps package.json but never biome.json, so the two fall ' +
        `out of lockstep on every bump. Expected exactly: ${RELATIVE_SCHEMA}`,
    ).toBe(RELATIVE_SCHEMA);
  });

  it('the schema file it names actually exists in the installed package', () => {
    const abs = fileURLToPath(new URL(`${ROOT}${RELATIVE_SCHEMA.slice(2)}`, import.meta.url));
    expect(
      existsSync(abs),
      `biome.json $schema names ${RELATIVE_SCHEMA}, but that file does not exist. ` +
        'If a Biome upgrade moved it, update biome.json and RELATIVE_SCHEMA together; ' +
        'if node_modules is simply absent, run `pnpm install` first.',
    ).toBe(true);
  });
});
