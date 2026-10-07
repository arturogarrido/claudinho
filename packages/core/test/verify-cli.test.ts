/**
 * `scripts/verify.mjs`: the `verify-claudinho` skill's control CLI (PR B of the adoption plan). It drives the REAL
 * built binary (`packages/cli/dist`, `packages/mcp/dist`: `pnpm -r build` first, as the smokes need) in an
 * environment BUILT FROM SCRATCH for every child, offline by default, and keeps the evidence of every child it ran.
 *
 * The contract pinned here (the design is the skill at .claude/skills/verify-claudinho/SKILL.md):
 *   - `doctor`: the dists, the version, a temporary config and cache of its own, the ambient variables REPORTED;
 *   - `run [--offline|--replay <corpus>|--live] [--follow <alias>] [--twin] [--env K=V] -- <argv>`: phases `follow`,
 *     `main`, `twin`, each with its own stdout, stderr and exit; the spawns the product asked for recorded and never
 *     started; every fetch attempt recorded with its outcome; the result one JSON object with `ok`, `mode`, `phases`,
 *     `spawns`, `fetches`, `env` (the child's keys), `paths`; the install commands, `star`, `_refresh` and `--copy`
 *     refused before any child; `--env` only for the scenario keys; the operator's environment never inherited;
 *   - `mcp`: one real stdio session (initialize, initialized, tools/list, tools/call); a stray stdout line, a protocol
 *     error, a missing reply or `isError` is `ok: false`; a silent server ends at the deadline, reaped;
 *   - `seed club --slug … --cache …` through the one seed; `seed none` an empty directory and nothing else;
 *   - `prompt` and `hook` on a seeded cache with the choice written by the CLI's own `follow`, stdin EOF;
 *   - `replay <corpus>`: the parity format `{url, status, body}` by sha256(url).slice(0, 24); a miss or a malformed
 *     recording fails the wrapper with the child's exit kept; raw and synthetic told apart; misses are run-owned;
 *   - deadlines: a hung child is killed and reaped, the partial evidence kept, `timedOut: true`, nonzero;
 *   - `capture`: the whole process group under `script` killed at the deadline (Darwin and Linux);
 *   - the evidence survives cleanup; the temporary HOME, config and cache do not (unless `--keep`);
 *   - the preloads are named by ABSOLUTE path on the child's NODE_OPTIONS, quoted when the path has a space;
 *   - the two SKILL.md copies byte-equal, the map's path named by both; and THE MAP'S TRIPWIRE: every `offline:` line
 *     of every feature file names a command `--help` lists, and that command, run through the control CLI, exits as
 *     the file says and prints the marker the file names.
 * The wrapper's exit: 0 when `ok`, 1 when a phase failed (a nonzero child, a miss, a malformed recording, a timeout,
 * an MCP failure), 2 for a usage error or a refusal before any child. The tree under test is the repository the
 * script lives in, or `VERIFY_ROOT` in the controller's OWN environment (the test's seam for a fake tree).
 * Never a wall-clock assertion; every dated command pins its date.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pidAlive, until } from './hermetic-shell';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const VERIFY = join(ROOT, 'scripts/verify.mjs');
/** The tracked modules the control CLI is made of: the test copies exactly these to a path with a space. */
const SCRIPT_FILES = ['verify.mjs', 'offline-preload.mjs', 'replay-preload.mjs', 'live-preload.mjs', 'spawn-count.mjs', 'statusline-seed.mjs'];
const CLI_DIST = join(ROOT, 'packages/cli/dist/index.js');
const MCP_DIST = join(ROOT, 'packages/mcp/dist/index.js');
const SKILL = join(ROOT, '.claude/skills/verify-claudinho/SKILL.md');
const SKILL_MIRROR = join(ROOT, '.cursor/skills/verify-claudinho/SKILL.md');
const FEATURES = join(ROOT, '.claude/skills/verify-claudinho/features');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8')).version as string;
const SLOW = 90_000;
const SCENARIO_KEYS = ['CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'CLAUDINHO_SOURCE', 'CLAUDINHO_MARKETS_SOURCE', 'LANG', 'TZ'];

type Phase = { exit: number | null; timedOut?: boolean; stdout: string; stderr: string };
type Fetch = { url: string; mode: string; outcome: string };
type Check = { name: string; ok: boolean; detail?: string };
type Result = {
  ok: boolean; mode?: string; timedOut?: boolean; error?: string; synthetic?: boolean;
  phases?: Record<string, Phase>; spawns?: unknown[]; fetches?: Fetch[]; env?: string[]; paths?: Record<string, string>;
  checks?: Check[]; tools?: Array<{ name: string; outputSchema?: unknown }>; content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>; isError?: boolean; wrote?: string | null; [k: string]: unknown;
};

const scratch = mkdtempSync(join(tmpdir(), 'verify-test-'));
mkdirSync(join(scratch, 'home'), { recursive: true });
mkdirSync(join(scratch, 'tmp'), { recursive: true });
/** The test's OWN environment for the controller: a HOME of its own, and a competition, team, language and zone the children must never see. */
function testEnv(extra: Record<string, string> = {}, strip: string[] = []): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp'), CLAUDINHO_COMPETITION: 'world-cup', CLAUDINHO_TEAM: 'Mexico', LANG: 'es_MX.UTF-8', TZ: 'America/Mexico_City', ...extra };
  for (const k of strip) delete env[k];
  return env;
}
let n = 0;
function out(): string { const d = join(scratch, `out-${++n}`); mkdirSync(d, { recursive: true }); return d; }
type Run = { r: ReturnType<typeof spawnSync>; res: Result | null; stdout: string; stderr: string };
/** Runs the control CLI and parses its one JSON object (`--json` is in `args`). */
function verify(args: string[], opts: { env?: Record<string, string>; strip?: string[]; timeout?: number; script?: string } = {}): Run {
  const r = spawnSync(process.execPath, [opts.script ?? VERIFY, ...args], { env: testEnv(opts.env, opts.strip), encoding: 'utf8', timeout: opts.timeout ?? SLOW, input: '', cwd: ROOT });
  let res: Result | null = null;
  try { res = JSON.parse(String(r.stdout)); } catch { res = null; }
  return { r, res, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}
function verifyAsync(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [VERIFY, ...args], { env: testEnv(env), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => {
      let res: Result | null = null;
      try { res = JSON.parse(stdout); } catch { res = null; }
      done({ r: { status } as ReturnType<typeof spawnSync>, res, stdout, stderr });
    });
  });
}
const twinOf = (res: Result | null): unknown => JSON.parse(res?.phases?.twin?.stdout ?? 'null');
const at = (o: unknown, path: string): unknown => path.split('.').reduce((v: unknown, k) => (v == null ? undefined : (v as Record<string, unknown>)[k]), o);
const sha = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24);
const pidFile = () => join(scratch, `pid-${++n}`);
const readPid = (f: string) => Number(readFileSync(f, 'utf8').trim());

/** A fake repository root for the controller's seam: an ES-module cli dist answering `--version`, an mcp dist, the two package.json files. */
function fakeRoot(cli: string, mcp = 'process.exit(0);\n', version = VERSION): string {
  const root = mkdtempSync(join(scratch, 'root-'));
  for (const p of ['cli', 'mcp']) {
    mkdirSync(join(root, 'packages', p, 'dist'), { recursive: true });
    writeFileSync(join(root, 'packages', p, 'package.json'), JSON.stringify({ name: `@claudinho/${p}`, version: VERSION, type: 'module' }));
  }
  writeFileSync(join(root, 'packages/cli/dist/index.js'), `if (process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); process.exit(0); }\n${cli}`);
  writeFileSync(join(root, 'packages/mcp/dist/index.js'), mcp);
  return root;
}
/** A fake stdio MCP server: a line-delimited JSON-RPC reader; `boot` printed first (a stray line); `list` false never answers tools/list. */
function fakeServer(o: { boot?: string; list?: boolean; pid?: string; schema?: boolean } = {}): string {
  return `${o.pid ? `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(o.pid)}, String(process.pid));\n` : ''}${o.boot ? `console.log(${JSON.stringify(o.boot)});\n` : ''}
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id == null) continue;
    if (msg.method === 'initialize') reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
    else if (msg.method === 'tools/list') { if (${o.list === false ? 'false' : 'true'}) reply(msg.id, { tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' }${o.schema === false ? '' : ', outputSchema: { type: \'object\' }'} }] }); }
    else reply(msg.id, { content: [{ type: 'text', text: 'ok' }], structuredContent: {} });
  }
});
process.stdin.on('end', () => process.exit(0));
setTimeout(() => {}, 600000);
`;
}

describe.skipIf(process.platform === 'win32')('scripts/verify.mjs, the control CLI, on the built dists', () => {
  it('needs the dists: pnpm -r build first', () => {
    expect(existsSync(CLI_DIST), 'packages/cli/dist').toBe(true);
    expect(existsSync(MCP_DIST), 'packages/mcp/dist').toBe(true);
  });

  it('exists, parses, and --help lists every command', () => {
    expect(existsSync(VERIFY), 'scripts/verify.mjs').toBe(true);
    expect(spawnSync(process.execPath, ['--check', VERIFY], { encoding: 'utf8' }).status).toBe(0);
    for (const f of SCRIPT_FILES) expect(existsSync(join(ROOT, 'scripts', f)), f).toBe(true);
    const r = spawnSync(process.execPath, [VERIFY, '--help'], { encoding: 'utf8', env: testEnv() });
    expect(r.status).toBe(0);
    for (const c of ['doctor', 'run', 'mcp', 'seed', 'prompt', 'hook', 'replay', 'capture']) expect(r.stdout).toMatch(new RegExp(`^\\s*${c}\\b`, 'm'));
  });

  it('doctor on the built tree is ok, REPORTS the ambient variables (set, then unset), and asks no feed', () => {
    const { r, res } = verify(['doctor', '--json', '--out', out()]);
    expect(r.status, String(r.stderr)).toBe(0);
    expect(res?.ok).toBe(true);
    const names = (res?.checks ?? []).map((c) => c.name);
    for (const want of ['node', 'cli-dist', 'mcp-dist', 'version', 'config-dir', 'cache-dir', 'env']) expect(names, want).toContain(want);
    expect((res?.checks ?? []).every((c) => c.ok)).toBe(true);
    const env = (res?.checks ?? []).find((c) => c.name === 'env');
    expect(env?.detail ?? '').toContain('CLAUDINHO_COMPETITION is set');
    expect(env?.detail ?? '').toContain('CLAUDINHO_TEAM is set');
    expect(res?.fetches ?? []).toEqual([]);
    const bare = verify(['doctor', '--json', '--out', out()], { strip: ['CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] });
    expect(bare.res?.ok).toBe(true);
    const detail = (bare.res?.checks ?? []).find((c) => c.name === 'env')?.detail ?? '';
    expect(detail).toContain('CLAUDINHO_COMPETITION is unset');
    expect(detail).toContain('CLAUDINHO_TEAM is unset');
  });

  it('doctor FAILs naming a missing dist (a root with no cli dist), exit 1', () => {
    const root = fakeRoot('process.exit(0);\n');
    rmSync(join(root, 'packages/cli/dist'), { recursive: true });
    const { r, res } = verify(['doctor', '--json', '--out', out()], { env: { VERIFY_ROOT: root } });
    expect(r.status).toBe(1);
    expect(res?.ok).toBe(false);
    expect((res?.checks ?? []).some((c) => !c.ok && /packages\/cli\/dist/.test(`${c.name} ${c.detail ?? ''}`))).toBe(true);
    const stale = fakeRoot('process.exit(0);\n', 'process.exit(0);\n', '0.0.0-stale');
    const v = verify(['doctor', '--json', '--out', out()], { env: { VERIFY_ROOT: stale } });
    expect(v.r.status, 'a dist whose --version differs from package.json').toBe(1);
    expect((v.res?.checks ?? []).find((c) => c.name === 'version')?.ok).toBe(false);
    expect((v.res?.checks ?? []).filter((c) => c.name !== 'version').every((c) => c.ok), 'only the version check fails').toBe(true);
  });

  it('run refuses the install commands, star, _refresh and --copy before any child; the temporary and the operator\'s settings stay untouched', () => {
    for (const argv of [['init', 'claude'], ['init-statusline'], ['init-hook'], ['init-cursor-statusline'], ['claude'], ['cursor'], ['star'], ['_refresh'], ['share', 'today', '--copy'], ['share', 'next', 'Arsenal', '--copy']]) {
      const { r, res, stderr } = verify(['run', '--json', '--out', out(), '--', ...argv]);
      expect(r.status, argv.join(' ')).toBe(2);
      expect(`${stderr}${res?.error ?? ''}`, argv.join(' ')).toMatch(/refus/i);
      expect(res?.phases ?? {}, argv.join(' ')).toEqual({});
    }
    expect(existsSync(join(scratch, 'home', '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(scratch, 'home', '.cursor'))).toBe(false);
    for (const [why, args] of [
      ['no argv after --', ['run', '--offline']],
      ['a label that is not a file name', ['run', '--label', '../x', '--offline', '--', 'team', 'mexico']],
      ['a capture label that is not a file name', ['capture', '../x', '--', 'team', 'mexico']],
      ['--synthetic without --replay', ['run', '--offline', '--synthetic', '--', 'team', 'mexico']],
      ['an unknown option', ['run', '--offline', '--frobnicate', '--', 'team', 'mexico']],
    ] as Array<[string, string[]]>) {
      const { r, res } = verify([args[0] as string, '--json', '--out', out(), ...args.slice(1)]);
      expect(r.status, why).toBe(2);
      expect(res?.phases ?? {}, why).toEqual({});
    }
  });

  it('--env accepts only the scenario keys, on every command: a harness-owned key or an unknown one is refused before any child', { timeout: SLOW }, () => {
    const corpus = mkdtempSync(join(scratch, 'corpus-'));
    const forms: Array<[string, string[]]> = [
      ['run', ['run', '--offline', '--', 'team', 'mexico']],
      ['replay', ['replay', corpus, '--', 'team', 'mexico']],
      ['capture', ['capture', 'c', '--', 'team', 'mexico']],
      ['mcp', ['mcp', '--list']],
      ['prompt', ['prompt']],
      ['hook', ['hook']],
    ];
    for (const bad of ['HOME=/tmp/x', 'USERPROFILE=/tmp/x', 'XDG_CONFIG_HOME=/tmp/x', 'XDG_CACHE_HOME=/tmp/x', 'TMPDIR=/tmp/x', 'NODE_OPTIONS=--import x', 'QA_SPAWN_LOG=/tmp/x', 'VERIFY_FETCH_LOG=/tmp/x', 'VERIFY_ROOT=/tmp/x', 'PARITY_SYNTHETIC=1', 'PATH=/tmp', 'FOO=bar', 'CLAUDINHO_NO_STAR=0', 'NO_COLOR=1']) {
      for (const [name, argv] of forms) {
        const { r, res, stderr } = verify([argv[0] as string, '--json', '--out', out(), '--env', bad, ...argv.slice(1)]);
        expect(r.status, `${name}: ${bad}`).toBe(2);
        expect(`${stderr}${res?.error ?? ''}`, `${name}: ${bad}`).toMatch(/env/i);
        expect(res?.phases ?? {}, `${name}: ${bad}`).toEqual({});
      }
    }
    const { r, res } = verify(['run', '--json', '--out', out(), '--offline', '--env', 'CLAUDINHO_COMPETITION=world-cup', '--twin', '--', 'today', '2026-10-07']);
    expect(r.status, String(res?.error)).toBe(0);
    expect(at(twinOf(res), 'competition.slug')).toBe('fifa.world');
    expect(at(twinOf(res), 'competition.chosenBy')).toBe('env');
    expect(res?.env ?? []).toContain('CLAUDINHO_COMPETITION');
    for (const k of SCENARIO_KEYS) expect(['CLAUDINHO_COMPETITION', 'LANG', 'TZ'].includes(k) || !(res?.env ?? []).includes(k), k).toBe(true);
  });

  it('a follow the CLI refuses stops the run before the main phase, its evidence kept, the wrapper 1', () => {
    const o = out();
    const { r, res } = verify(['run', '--json', '--out', o, '--label', 'f', '--offline', '--follow', 'not-an-alias', '--twin', '--', 'team', 'mexico']);
    expect(r.status).toBe(1);
    expect(res?.ok).toBe(false);
    expect(res?.phases?.follow?.exit).not.toBe(0);
    expect(res?.phases?.main, 'no main phase after a refused follow').toBeUndefined();
    expect(res?.phases?.twin).toBeUndefined();
    expect(readdirSync(o)).toContain('f.follow.err');
  });

  it('the child\'s environment is built from scratch: the test\'s own competition, team, language and zone never reach it', { timeout: SLOW }, () => {
    const { r, res } = verify(['run', '--json', '--out', out(), '--offline', '--follow', 'premier-league', '--twin', '--', 'today', '2026-10-07']);
    expect(r.status, `${res?.error} ${res?.phases?.main?.stderr}`).toBe(0);
    expect(res?.ok).toBe(true);
    expect(res?.mode).toBe('offline');
    expect(at(twinOf(res), 'competition.slug')).toBe('eng.1');
    expect(at(twinOf(res), 'competition.chosenBy')).toBe('saved');
    expect(res?.env ?? []).not.toContain('CLAUDINHO_COMPETITION');
    expect(res?.env ?? []).not.toContain('CLAUDINHO_TEAM');
    for (const key of ['PATH', 'HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'TZ', 'LANG', 'NODE_OPTIONS', 'QA_SPAWN_LOG', 'VERIFY_FETCH_LOG', 'CLAUDINHO_NO_STAR', 'NO_COLOR']) expect(res?.env ?? [], key).toContain(key);
    expect(res?.phases?.follow?.exit).toBe(0);
    expect(res?.phases?.main?.exit).toBe(0);
    expect(res?.phases?.main?.stdout).toContain('Premier League');
    expect(res?.phases?.main?.stdout, 'English: the test\'s Spanish never reached the child').toContain("Couldn't reach the data provider");
    expect(res?.phases?.main?.stdout).not.toContain(String.fromCodePoint(0x1b)); // NO_COLOR
    expect(res?.paths?.home ?? '').not.toBe(join(scratch, 'home')); // the controller's HOME is not the child's
  });

  it('every fetch attempt is recorded and blocked offline, and no backoff is persisted (a network error, never a status)', { timeout: SLOW }, () => {
    const { r, res } = verify(['run', '--json', '--out', out(), '--offline', '--follow', 'premier-league', '--keep', '--', 'today', '2026-10-07']);
    expect(r.status).toBe(0);
    expect((res?.fetches ?? []).length).toBeGreaterThan(0);
    expect((res?.fetches ?? []).every((f) => f.outcome === 'blocked' && f.mode === 'offline')).toBe(true);
    expect((res?.fetches ?? []).some((f) => /espn\.com.*eng\.1.*dates=20261007/.test(f.url))).toBe(true);
    const cache = res?.paths?.cache ?? '';
    expect(existsSync(cache), 'kept with --keep').toBe(true);
    const files = existsSync(join(cache, 'claudinho')) ? readdirSync(join(cache, 'claudinho')) : [];
    expect(files.filter((f) => /backoff/.test(f))).toEqual([]);
  });

  it('the positive control: a child that fetches once shows one blocked attempt offline, and one miss (ok false, its exit kept) under an empty corpus', () => {
    const root = fakeRoot("await fetch('https://example.invalid/control').catch(() => {}); console.log('done');\n");
    const a = verify(['run', '--json', '--out', out(), '--offline', '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(a.r.status, a.res?.error).toBe(0);
    expect(a.res?.fetches).toEqual([{ url: 'https://example.invalid/control', mode: 'offline', outcome: 'blocked' }]);
    expect(a.res?.phases?.main?.stdout).toContain('done');
    const corpus = mkdtempSync(join(scratch, 'corpus-'));
    const b = verify(['run', '--json', '--out', out(), '--replay', corpus, '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(b.r.status).toBe(1);
    expect(b.res?.ok).toBe(false);
    expect(b.res?.phases?.main?.exit, 'the child\'s own exit is kept').toBe(0);
    expect((b.res?.fetches ?? []).map((f) => f.outcome)).toEqual(['miss']);
    expect(existsSync(join(corpus, 'misses.log')), 'misses are run-owned, never the corpus\'s').toBe(false);
    expect(readdirSync(corpus), 'the corpus is never written').toEqual([]);
  });

  it('two concurrent replays under one empty corpus each own their one miss', async () => {
    const root = fakeRoot("await fetch('https://example.invalid/control').catch(() => {}); console.log('done');\n");
    const corpus = mkdtempSync(join(scratch, 'corpus-'));
    const [a, b] = await Promise.all([
      verifyAsync(['run', '--json', '--out', out(), '--replay', corpus, '--', 'today'], { VERIFY_ROOT: root }),
      verifyAsync(['run', '--json', '--out', out(), '--replay', corpus, '--', 'today'], { VERIFY_ROOT: root }),
    ]);
    for (const x of [a, b]) {
      expect(x.res?.ok).toBe(false);
      expect((x.res?.fetches ?? []).map((f) => f.outcome)).toEqual(['miss']);
    }
    expect(a.res?.paths?.out).not.toBe(b.res?.paths?.out);
  });

  it('replay: a corpus fabricated for EVERY URL the command requests serves them (all replayed:raw); a corrupt recording is malformed; a synthetic entry is told apart', { timeout: SLOW }, () => {
    const probe = verify(['run', '--json', '--out', out(), '--offline', '--follow', 'premier-league', '--', 'today', '2026-10-07']);
    const urls = [...new Set((probe.res?.fetches ?? []).map((f) => f.url))];
    expect(urls.length).toBeGreaterThan(0);
    const corpus = mkdtempSync(join(scratch, 'corpus-'));
    const standings = readFileSync(join(ROOT, 'packages/core/test/fixtures/standings/eng.1.json'), 'utf8');
    for (const url of urls) {
      const body = /standings/.test(url) ? standings : JSON.stringify({ events: [] });
      writeFileSync(join(corpus, `${sha(url)}.json`), JSON.stringify({ url, status: 200, body }));
    }
    const ok = verify(['run', '--json', '--out', out(), '--replay', corpus, '--follow', 'premier-league', '--twin', '--', 'today', '2026-10-07']);
    expect(ok.r.status, `${ok.res?.error} ${JSON.stringify(ok.res?.fetches)}`).toBe(0);
    expect(ok.res?.ok).toBe(true);
    expect(ok.res?.mode).toBe('replay');
    expect(ok.res?.synthetic).toBe(false);
    expect((ok.res?.fetches ?? []).length).toBeGreaterThan(0);
    expect((ok.res?.fetches ?? []).every((f) => f.outcome === 'replayed:raw' && f.mode === 'replay')).toBe(true);
    expect(at(twinOf(ok.res), 'degraded')).toBe(false);
    expect(at(twinOf(ok.res), 'source')).toBe('espn');
    expect(ok.res?.phases?.main?.stdout).toContain('Live data: ESPN');
    // a corrupt recording: an object body is not a recording (the three type rules). The adapter asks the standings
    // (group enrichment) BEFORE the scoreboard and never fails on them, so the corrupted recording must be a day's.
    const first = urls.find((u) => /scoreboard/.test(u)) as string;
    writeFileSync(join(corpus, `${sha(first)}.json`), JSON.stringify({ url: first, status: 200, body: { events: [] } }));
    const bad = verify(['run', '--json', '--out', out(), '--replay', corpus, '--follow', 'premier-league', '--', 'today', '2026-10-07']);
    expect(bad.r.status).toBe(1);
    expect(bad.res?.ok).toBe(false);
    expect((bad.res?.fetches ?? []).some((f) => f.url === first && f.outcome === 'malformed')).toBe(true);
    expect(bad.res?.phases?.main?.exit, 'the product degraded and exited on its own').toBe(0);
    for (const broken of ['not json', JSON.stringify({ url: 'https://other.invalid/', status: 200, body: '{}' }), JSON.stringify({ url: first, status: 99, body: '{}' }), JSON.stringify({ url: first, status: '200', body: '{}' })]) {
      writeFileSync(join(corpus, `${sha(first)}.json`), broken);
      const b = verify(['run', '--json', '--out', out(), '--replay', corpus, '--follow', 'premier-league', '--', 'today', '2026-10-07']);
      expect((b.res?.fetches ?? []).find((f) => f.url === first)?.outcome, broken).toBe('malformed');
    }
    // malformed provider BYTES inside a valid string body reach the product: a provider case, never a controller failure
    writeFileSync(join(corpus, `${sha(first)}.json`), JSON.stringify({ url: first, status: 200, body: '<html>not json' }));
    const bytes = verify(['run', '--json', '--out', out(), '--replay', corpus, '--follow', 'premier-league', '--twin', '--', 'today', '2026-10-07']);
    expect(bytes.res?.ok).toBe(true);
    expect((bytes.res?.fetches ?? []).find((f) => f.url === first)?.outcome).toBe('replayed:raw');
    expect(at(twinOf(bytes.res), 'degraded')).toBe(true);
    // a synthetic entry, served only under the flag, and said so
    writeFileSync(join(corpus, `${sha(first)}.json`), JSON.stringify({ url: first, status: 400, body: 'Failed' }));
    mkdirSync(join(corpus, 'synthetic'), { recursive: true });
    writeFileSync(join(corpus, 'synthetic', `${sha(first)}.json`), JSON.stringify({ url: first, status: 200, body: JSON.stringify({ events: [] }) }));
    const raw = verify(['run', '--json', '--out', out(), '--replay', corpus, '--follow', 'premier-league', '--twin', '--', 'today', '2026-10-07']);
    expect((raw.res?.fetches ?? []).find((f) => f.url === first)?.outcome).toBe('replayed:raw');
    expect(at(twinOf(raw.res), 'degraded')).toBe(true);
    const syn = verify(['run', '--json', '--out', out(), '--replay', corpus, '--synthetic', '--follow', 'premier-league', '--twin', '--', 'today', '2026-10-07']);
    expect((syn.res?.fetches ?? []).find((f) => f.url === first)?.outcome).toBe('replayed:synthetic');
    expect(syn.res?.synthetic).toBe(true);
    expect(at(twinOf(syn.res), 'degraded')).toBe(false);
    // a missing corpus is a usage error before any child; two modes at once too
    const gone = verify(['run', '--json', '--out', out(), '--replay', join(scratch, 'no-such-corpus'), '--', 'team', 'mexico']);
    expect(gone.r.status).toBe(2);
    expect(gone.res?.phases ?? {}).toEqual({});
    const two = verify(['run', '--json', '--out', out(), '--offline', '--replay', corpus, '--', 'team', 'mexico']);
    expect(two.r.status).toBe(2);
    expect(two.res?.phases ?? {}).toEqual({});
  });

  it('the preloads ride NODE_OPTIONS by absolute path, quoted: the control CLI works from a directory with a space', { timeout: SLOW }, () => {
    const dir = join(mkdtempSync(join(scratch, 'spaced-')), 'with space', 'scripts');
    mkdirSync(dir, { recursive: true });
    for (const f of SCRIPT_FILES) cpSync(join(ROOT, 'scripts', f), join(dir, f));
    const { r, res } = verify(['run', '--json', '--out', out(), '--offline', '--follow', 'premier-league', '--', 'today', '2026-10-07'], { env: { VERIFY_ROOT: ROOT }, script: join(dir, 'verify.mjs') });
    expect(r.status, `${res?.error} ${res?.phases?.main?.stderr}`).toBe(0);
    expect(res?.ok).toBe(true);
    expect((res?.fetches ?? []).length, 'the preload at the spaced path was loaded').toBeGreaterThan(0);
    expect((res?.fetches ?? []).every((f) => f.outcome === 'blocked')).toBe(true);
    expect(res?.spawns, 'the spawn counter at the spaced path was loaded').toEqual([]);
  });

  it('mcp: tools/list has ten tools each with an outputSchema; one call returns its text and data; offline get_today is degraded; a tool error and an unknown tool are ok false', { timeout: SLOW }, () => {
    const list = verify(['mcp', '--json', '--out', out(), '--list']);
    expect(list.r.status, list.res?.error).toBe(0);
    expect((list.res?.tools ?? []).length).toBe(10);
    expect((list.res?.tools ?? []).every((t) => t.outputSchema != null)).toBe(true);
    const comps = verify(['mcp', '--json', '--out', out(), 'list_competitions']);
    expect(comps.res?.ok).toBe(true);
    expect((at(comps.res?.structuredContent, 'competitions') as unknown[]).length).toBe(15);
    expect((comps.res?.content ?? []).some((c) => c.type === 'text' && (c.text ?? '').length > 0)).toBe(true);
    const team = verify(['mcp', '--json', '--out', out(), 'get_team', '{"query":"mexico"}']);
    expect(at(team.res?.structuredContent, 'team.code')).toBe('MEX');
    expect(team.res?.fetches).toEqual([]);
    const today = verify(['mcp', '--json', '--out', out(), '--offline', '--follow', 'premier-league', 'get_today', '{"date":"2026-10-07"}']);
    expect(today.res?.ok, JSON.stringify(today.res)).toBe(true);
    expect(today.res?.mode).toBe('offline');
    expect(at(today.res?.structuredContent, 'degraded')).toBe(true);
    expect(at(today.res?.structuredContent, 'competition.slug')).toBe('eng.1');
    expect((today.res?.fetches ?? []).length).toBeGreaterThan(0);
    expect((today.res?.fetches ?? []).every((f) => f.outcome === 'blocked')).toBe(true);
    const bad = verify(['mcp', '--json', '--out', out(), 'get_today', '{"competition":"nope"}']);
    expect(bad.res?.ok).toBe(false);
    expect(bad.res?.isError).toBe(true);
    expect(bad.r.status).toBe(1);
    const unknown = verify(['mcp', '--json', '--out', out(), 'no_such_tool']);
    expect(unknown.res?.ok).toBe(false);
    expect(unknown.res?.error ?? '').not.toBe('');
    expect(unknown.r.status).toBe(1);
  });

  it('mcp: a stray stdout line from an otherwise valid server is ok false; a silent server ends at the deadline, reaped, the partial evidence kept', { timeout: SLOW }, async () => {
    const chatty = fakeRoot('process.exit(0);\n', fakeServer({ boot: 'boot' }));
    const c = verify(['mcp', '--json', '--out', out(), '--list'], { env: { VERIFY_ROOT: chatty } });
    expect(c.res?.ok).toBe(false);
    expect(c.r.status).toBe(1);
    expect(c.res?.timedOut ?? false).toBe(false);
    const clean = fakeRoot('process.exit(0);\n', fakeServer());
    const ok = verify(['mcp', '--json', '--out', out(), '--list'], { env: { VERIFY_ROOT: clean } });
    expect(ok.res?.ok, 'the same server without the stray line is fine').toBe(true);
    expect((ok.res?.tools ?? []).map((t) => t.name)).toEqual(['t']);
    const bare = fakeRoot('process.exit(0);\n', fakeServer({ schema: false }));
    const b = verify(['mcp', '--json', '--out', out(), '--list'], { env: { VERIFY_ROOT: bare } });
    expect(b.res?.ok, 'a tool without an outputSchema fails the session').toBe(false);
    expect(b.r.status).toBe(1);
    const pf = pidFile();
    const root = fakeRoot('process.exit(0);\n', fakeServer({ list: false, pid: pf }));
    const { r, res } = verify(['mcp', '--json', '--out', out(), '--timeout', '2', '--list'], { env: { VERIFY_ROOT: root } });
    expect(r.status).toBe(1);
    expect(res?.ok).toBe(false);
    expect(res?.timedOut).toBe(true);
    expect(existsSync(pf), 'the server ran').toBe(true);
    expect(await until(() => !pidAlive(readPid(pf)), 3000), 'the server was reaped').toBe(true);
    expect(existsSync(res?.paths?.out ?? ''), 'the evidence directory').toBe(true);
    expect(readdirSync(res?.paths?.out ?? '').some((f) => /\.txt$/.test(f)), 'the partial transcript').toBe(true);
  });

  it('seed club writes the one seed for the slug; seed none writes nothing but an empty directory; --dry-run writes nothing', () => {
    const cache = mkdtempSync(join(scratch, 'cache-'));
    const dry = verify(['seed', 'club', '--slug', 'eng.1', '--cache', cache, '--json', '--dry-run']);
    expect(dry.r.status).toBe(0);
    expect(dry.res?.wrote ?? '').toMatch(/state\.espn\.eng\.1\.json$/);
    expect(readdirSync(cache)).toEqual([]);
    const wet = verify(['seed', 'club', '--slug', 'eng.1', '--cache', cache, '--json']);
    expect(wet.r.status).toBe(0);
    expect(wet.res?.wrote ?? '').toMatch(/state\.espn\.eng\.1\.json$/);
    expect(existsSync(join(cache, 'claudinho', 'state.espn.eng.1.json'))).toBe(true);
    const none = mkdtempSync(join(scratch, 'cache-'));
    const nn = verify(['seed', 'none', '--cache', none, '--json']);
    expect(nn.r.status).toBe(0);
    expect(nn.res?.wrote ?? null).toBeNull();
    expect(readdirSync(none)).toEqual([]);
    const rel = verify(['seed', 'club', '--slug', 'eng.1', '--cache', 'relative/dir', '--json']);
    expect(rel.r.status, 'a relative cache is a usage error').toBe(2);
    const full = mkdtempSync(join(scratch, 'cache-'));
    writeFileSync(join(full, 'keep.txt'), 'mine');
    const refused = verify(['seed', 'none', '--cache', full, '--json']);
    expect(refused.r.status, 'seed none refuses a directory with entries').toBe(2);
    expect(readdirSync(full), 'and deletes nothing').toEqual(['keep.txt']);
  });

  it('the evidence survives cleanup, per phase, the empty logs included; the temporary HOME, config and cache do not (unless --keep)', { timeout: SLOW }, () => {
    const o = out();
    const { r, res } = verify(['run', '--json', '--out', o, '--label', 'ev', '--offline', '--twin', '--', 'today', '2026-10-07']);
    expect(r.status, 'nothing chosen is exit 1 on both phases, so the wrapper is 1').toBe(1);
    expect(res?.ok).toBe(false);
    const files = readdirSync(o);
    for (const f of ['ev.main.txt', 'ev.main.err', 'ev.main.exit', 'ev.twin.txt', 'ev.twin.err', 'ev.twin.exit', 'ev.spawns', 'ev.fetches', 'ev.result.json']) expect(files, f).toContain(f);
    expect(readFileSync(join(o, 'ev.main.exit'), 'utf8').trim()).toBe('1');
    expect(readFileSync(join(o, 'ev.twin.txt'), 'utf8')).toMatch(/"noCompetition": true/);
    expect(readFileSync(join(o, 'ev.main.err'), 'utf8')).toMatch(/No competition chosen/);
    expect(readFileSync(join(o, 'ev.fetches'), 'utf8')).toBe('');
    expect(JSON.parse(readFileSync(join(o, 'ev.result.json'), 'utf8')).ok).toBe(false);
    for (const key of ['home', 'config', 'cache']) {
      const p = res?.paths?.[key] ?? '';
      expect(p, key).not.toBe('');
      expect(existsSync(p), `${key} removed`).toBe(false);
    }
    expect(res?.paths?.out).toBe(o);
    const kept = verify(['run', '--json', '--out', out(), '--offline', '--keep', '--', 'team', 'mexico']);
    for (const key of ['home', 'config', 'cache']) expect(existsSync(kept.res?.paths?.[key] ?? ''), `${key} kept`).toBe(true);
    const dflt = verify(['run', '--json', '--offline', '--', 'team', 'mexico']);
    expect(dflt.r.status).toBe(0);
    expect(dflt.res?.paths?.out ?? '', 'the default evidence directory is under the controller\'s TMPDIR').toContain(join(scratch, 'tmp'));
    expect(existsSync(dflt.res?.paths?.out ?? '')).toBe(true);
  });

  it('a hung child ends at the deadline: killed and reaped, timedOut, the partial evidence kept, nonzero', { timeout: SLOW }, async () => {
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); console.log('started'); setTimeout(() => {}, 600000);\n`);
    const { r, res } = verify(['run', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(r.status).toBe(1);
    expect(res?.ok).toBe(false);
    expect(res?.timedOut).toBe(true);
    expect(res?.phases?.main?.timedOut).toBe(true);
    expect(res?.phases?.main?.stdout).toContain('started');
    expect(await until(() => !pidAlive(readPid(pf)), 3000), 'the child was reaped').toBe(true);
    const ignoring = fakeRoot(`process.on('SIGTERM', () => {}); console.log('ignoring'); setTimeout(() => {}, 600000);\n`);
    const k = verify(['run', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: ignoring }, timeout: 20_000 });
    expect(k.res?.timedOut, 'TERM ignored, KILL follows').toBe(true);
    expect(k.res?.phases?.main?.stdout).toContain('ignoring');
  });

  it('capture: the combined pty transcript as .ansi and .txt with the child\'s status; a child that ignores TERM is gone with its whole group at the deadline', { timeout: SLOW }, async () => {
    const o = out();
    const good = verify(['capture', 'cap', '--json', '--out', o, '--offline', '--', 'team', 'mexico']);
    expect(good.r.status, good.res?.error).toBe(0);
    expect(existsSync(join(o, 'cap.ansi'))).toBe(true);
    expect(readFileSync(join(o, 'cap.txt'), 'utf8')).toContain('Mexico');
    expect(readFileSync(join(o, 'cap.txt'), 'utf8').includes(String.fromCodePoint(0x1b)), 'no escapes in the .txt').toBe(false);
    expect(good.res?.env ?? []).not.toContain('NO_COLOR');
    const status = fakeRoot("console.log('seven'); process.exit(7);\n");
    const seven = verify(['capture', 'seven', '--json', '--out', out(), '--', 'today'], { env: { VERIFY_ROOT: status } });
    expect(seven.res?.phases?.main?.exit, 'the child\'s status is the capture\'s').toBe(7);
    expect(seven.res?.ok).toBe(false);
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const o2 = out();
    const hung = verify(['capture', 'hang', '--json', '--out', o2, '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(hung.r.status).toBe(1);
    expect(hung.res?.ok).toBe(false);
    expect(hung.res?.timedOut).toBe(true);
    expect(await until(() => existsSync(pf), 3000)).toBe(true);
    expect(await until(() => !pidAlive(readPid(pf)), 5000), 'the TERM-ignoring child under script is gone').toBe(true);
    expect(existsSync(join(o2, 'hang.ansi')), 'the partial transcript is kept').toBe(true);
    expect(readFileSync(join(o2, 'hang.txt'), 'utf8')).toContain('hanging');
  });

  it('the two SKILL.md copies are byte-equal and both name the one map; the map has the five surfaces', () => {
    expect(readFileSync(SKILL, 'utf8')).toBe(readFileSync(SKILL_MIRROR, 'utf8'));
    for (const f of [SKILL, SKILL_MIRROR]) expect(readFileSync(f, 'utf8')).toContain('.claude/skills/verify-claudinho/features/');
    expect(readdirSync(FEATURES).sort()).toEqual(['live.md', 'next.md', 'statusline.md', 'table.md', 'today.md']);
    expect(readFileSync(SKILL, 'utf8')).not.toMatch(/docs\/[a-z]/i);
  });
});

/** The map's grammar: `- offline: \`<command>\`` then `  proves: <clause>; <clause>; …`. */
type Line = { file: string; command: string; clauses: string[] };
export function offlineLines(dir: string): Line[] {
  const lines: Line[] = [];
  for (const f of readdirSync(dir).sort()) {
    const text = readFileSync(join(dir, f), 'utf8').split('\n');
    for (let i = 0; i < text.length; i++) {
      const m = /^- offline: `(.+)`$/.exec(text[i] ?? '');
      if (!m) continue;
      const p = /^ {2}proves: (.+)$/.exec(text[i + 1] ?? '');
      if (!p) throw new Error(`${f}: the offline line "${m[1]}" has no proves: line under it`);
      lines.push({ file: f, command: m[1] as string, clauses: (p[1] as string).split(';').map((c) => c.trim()).filter(Boolean) });
    }
  }
  return lines;
}
const CLAUSES: Array<[RegExp, (m: RegExpExecArray, res: Result | null) => void]> = [
  [/^exit (\d+)$/, (m, res) => expect(res?.phases?.main?.exit).toBe(Number(m[1]))],
  [/^stdout contains "(.+)"$/, (m, res) => expect(res?.phases?.main?.stdout ?? '').toContain(m[1])],
  [/^stderr contains "(.+)"$/, (m, res) => expect(res?.phases?.main?.stderr ?? '').toContain(m[1])],
  [/^stdout is empty$/, (_m, res) => expect((res?.phases?.main?.stdout ?? '').trim()).toBe('')],
  [/^twin\.([a-zA-Z0-9_.]+)\.length = (\d+)$/, (m, res) => expect((at(twinOf(res), m[1] as string) as unknown[]).length).toBe(Number(m[2]))],
  [/^twin\.([a-zA-Z0-9_.]+) = (.+)$/, (m, res) => expect(at(twinOf(res), m[1] as string)).toEqual(JSON.parse(m[2] as string))],
  [/^spawns = (\d+)$/, (m, res) => expect((res?.spawns ?? []).length).toBe(Number(m[1]))],
  [/^fetches = \[\]$/, (_m, res) => expect(res?.fetches ?? null).toEqual([])],
  [/^fetches all blocked$/, (_m, res) => {
    expect((res?.fetches ?? []).length).toBeGreaterThan(0);
    expect((res?.fetches ?? []).every((f) => f.outcome === 'blocked')).toBe(true);
  }],
];
function check(clause: string, res: Result | null): void {
  for (const [re, assert] of CLAUSES) {
    const m = re.exec(clause);
    if (m) { assert(m, res); return; }
  }
  throw new Error(`unknown clause in the map: ${clause}`);
}

describe.skipIf(process.platform === 'win32')('the map\'s tripwire: every offline line of every feature file drives and proves', () => {
  const lines = offlineLines(FEATURES);
  it('reads at least the five surfaces\' lines, each naming a command --help lists', () => {
    expect(lines.length).toBeGreaterThanOrEqual(11);
    const help = spawnSync(process.execPath, [VERIFY, '--help'], { encoding: 'utf8', env: testEnv() }).stdout;
    for (const l of lines) expect(help, `${l.file}: ${l.command}`).toMatch(new RegExp(`^\\s*${(l.command.split(' ')[0] as string)}\\b`, 'm'));
  });
  for (const l of lines) {
    it(`${l.file}: ${l.command}`, { timeout: SLOW }, () => {
      const parts = l.command.split(' ');
      const argv = [parts[0] as string, '--json', '--out', out(), '--label', 'map', ...parts.slice(1)];
      const { r, res } = verify(argv);
      expect(res, `no result: status ${r.status} ${r.stderr}`).not.toBeNull();
      for (const c of l.clauses) check(c, res);
    });
  }
});
