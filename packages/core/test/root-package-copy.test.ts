/**
 * The root package.json (private: nobody's listing) says the cli package's
 * first clause (0.11 · 2.7), and so carries the framing's count: it is pinned
 * to the supported table like every other static copy that carries it, so a
 * new row fails here too until the sentence is updated.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUPPORTED } from '../src';

const root = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as {
  description?: unknown;
};

describe('the root package.json', () => {
  it("says the cli sentence's first clause, with the digit the table gives and no em-dash", () => {
    const description = String(root.description);
    expect(description).toBe(
      `Live football scores, fixtures and standings in your terminal and your Claude Code and Cursor CLI statusline, for the competition you follow: the World Cup, the Premier League, LALIGA, the Champions League and ${SUPPORTED.length - 4} more.`,
    );
    expect(description).not.toMatch(/—/);
  });
});
