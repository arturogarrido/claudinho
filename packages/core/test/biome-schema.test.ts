import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `biome.json` lives at the REPO ROOT and pins the config schema BY VERSION
 * (`https://biomejs.dev/schemas/<version>/schema.json`), but Dependabot only ever
 * bumps `@biomejs/biome` in the root `package.json` — it never touches biome.json.
 * The two then drift and Biome reports a schema-version mismatch on every lint run.
 *
 * This has now drifted on three separate bumps (2.5.2, 2.5.3, 2.5.4), each caught
 * by a human reading lint output after the fact. Guard it so CI catches the next
 * one instead — same escalation as the knockout-surface coverage test: when a bug
 * recurs, stop relying on review vigilance.
 *
 * Compared against the version DECLARED in package.json (not the resolved
 * node_modules copy) because that is exactly what Dependabot rewrites, and it
 * stays deterministic regardless of install layout.
 */
const readRoot = (rel: string) =>
  JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));

describe('biome.json $schema stays in lockstep with @biomejs/biome', () => {
  const biomeConfig = readRoot('biome.json') as { $schema?: string };
  const rootPkg = readRoot('package.json') as { devDependencies?: Record<string, string> };

  const declared = rootPkg.devDependencies?.['@biomejs/biome'];
  /** Strip a leading range operator (^, ~, >=, …) to get the pinned version. */
  const declaredVersion = declared?.replace(/^[\^~>=<\s]*/, '');
  const schemaVersion = biomeConfig.$schema?.match(/schemas\/(\d+\.\d+\.\d+)\//)?.[1];

  it('root package.json declares a concrete @biomejs/biome version', () => {
    expect(declared).toBeTruthy();
    expect(declaredVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('$schema is a versioned biomejs.dev schema URL', () => {
    expect(biomeConfig.$schema).toMatch(
      /^https:\/\/biomejs\.dev\/schemas\/\d+\.\d+\.\d+\/schema\.json$/,
    );
  });

  it('$schema version matches the declared biome version (the drift guard)', () => {
    expect(
      schemaVersion,
      `biome.json $schema is ${schemaVersion}, but package.json declares ` +
        `@biomejs/biome ${declaredVersion}. Bump the $schema URL to match — ` +
        'hand-edit the single line; `biome migrate` reformats the whole config to tabs.',
    ).toBe(declaredVersion);
  });
});
