/**
 * 0.11 · 2.5b: the MCP server READS one file, the user's config file (the
 * saved choice and the pinned team, written only by `claudinho follow`), and
 * writes none. It reads it the way the CLI does: through core's one bounded,
 * non-blocking, no-follow reader (`readUserConfig`, on `lookAtOwnFile`), once
 * per request, at the edge where the request's competition is decided. A file
 * read by path can be anything by the time it is read (a pipe the read waits
 * on for ever, a file far larger than a check allowed, a link to another
 * file), so no module of the server reads a file by path, and none touches the
 * filesystem at all: pinned by vocabulary, like the CLI's
 * (`packages/cli/test/cache-reads.test.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** A file's code: its lines that are not comments. */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');

const sources = () =>
  readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SRC, f));

describe('the one file the server reads goes through core', () => {
  it('no module reads a file by path, or touches the filesystem itself', () => {
    const readers = sources().filter((f) => /\breadFileSync\s*\(|\breadFile\s*\(|\bopenSync\s*\(|['"]node:fs(\/promises)?['"]|['"]fs['"]/.test(code(f)));
    expect(readers).toEqual([]);
  });

  it('nor writes one', () => {
    const writers = sources().filter((f) => /\bwriteFile(Sync)?\s*\(|\bwriteFileAtomic\s*\(|\brmSync\s*\(|\bmkdirSync\s*\(/.test(code(f)));
    expect(writers).toEqual([]);
  });

  it('the config file is read at the edge, through core, once per request', () => {
    const tools = code(join(SRC, 'tools.ts'));
    expect(tools).toMatch(/\breadUserConfig\(configPath\(process\.env, process\.platform, homedir\(\)\)\)/);
    // One call site: the request's choice, remembered against its args.
    expect(tools.match(/\breadUserConfig\(/g)).toHaveLength(1);
    expect(code(join(SRC, 'server.ts'))).not.toMatch(/\breadUserConfig\(/);
  });
});
