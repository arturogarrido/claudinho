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
 *   - the logs are per PHASE (`<label>.<phase>.fetches`, `.spawns`), every fetch entry naming its phase; the label
 *     is reserved in `--out` when a command starts (a taken label is refused) and has no dot (so no two labels'
 *     files coincide); the evidence directory, default or asked, is never inside the replay corpus; the MCP server's
 *     own exit is part of `ok`; a reply is judged before it is believed, envelope and body (a result or an error; the
 *     initialize fields; each tool's shape; each content item; `isError` a boolean); every launch function of
 *     child_process is recorded and inert; `ps` is bounded and killed hard, asked again at the KILL step, and a
 *     descendant it may have missed is said; a preload that cannot write its log says so on stderr and the phase
 *     fails; the live preload logs the attempt before the request;
 *   - the two SKILL.md copies byte-equal, the map's path named by both, every AGENTS.md lead the skill cites present
 *     there; and THE MAP'S TRIPWIRE: every `offline:` line of every feature file (at least one per file, twelve in
 *     all) names a command `--help` lists, and that command, run through the control CLI, exits as the file says and
 *     prints the marker the file names.
 * The wrapper's exit: 0 when `ok`, 1 when a phase failed (a nonzero child, a miss, a malformed recording, a timeout,
 * an MCP failure), 2 for a usage error or a refusal before any child. The tree under test is the repository the
 * script lives in, or `VERIFY_ROOT` in the controller's OWN environment (the test's seam for a fake tree).
 * Never a wall-clock assertion; every dated command pins its date.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
const AGENTS = join(ROOT, 'AGENTS.md');
const PRELOADS = { offline: join(ROOT, 'scripts/offline-preload.mjs'), replay: join(ROOT, 'scripts/replay-preload.mjs'), live: join(ROOT, 'scripts/live-preload.mjs') };
/** The bold leads of AGENTS.md the skill and the map cite by their words. */
const CITED_LEADS = [
  'Every data vendor implements the `ProviderAdapter` interface',
  'Text has ROLES, not one universal cleaner',
  'A verdict becomes output in ONE place',
  'The competition is decided ONCE, at the edge, and then travels as a value',
  'Knockout/team-facing surfaces MUST live-resolve',
];
const VERSION = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8')).version as string;
const SLOW = 90_000;
const SCENARIO_KEYS = ['CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'CLAUDINHO_SOURCE', 'CLAUDINHO_MARKETS_SOURCE', 'LANG', 'TZ'];

type Phase = { exit: number | null; timedOut?: boolean; survivorPossible?: boolean; survivorReason?: string; stdout: string; stderr: string };
type Fetch = { url: string; mode: string; outcome: string; phase?: string };
type Check = { name: string; ok: boolean; detail?: string };
type Result = {
  ok: boolean; mode?: string; timedOut?: boolean; error?: string; synthetic?: boolean;
  phases?: Record<string, Phase>; spawns?: unknown[]; fetches?: Fetch[]; env?: string[]; paths?: Record<string, string>;
  checks?: Check[]; tools?: Array<{ name: string; outputSchema?: unknown }>; content?: Array<{ type: string; text?: string }>; failures?: string[]; exit?: number | null;
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
  const r = spawnSync(process.execPath, [opts.script ?? VERIFY, ...args], { env: testEnv(opts.env, opts.strip), encoding: 'utf8', timeout: opts.timeout ?? SLOW, killSignal: 'SIGKILL', input: '', cwd: ROOT });
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
/** A directory holding one executable stub, to go first on the controller's PATH. */
function stubTool(name: string, body: string): string {
  const dir = mkdtempSync(join(scratch, `stub-${name}-`));
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  return dir;
}
const withTool = (dir: string) => `${dir}:${process.env.PATH ?? ''}`;
const jsonLines = (file: string): unknown[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown);
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
function fakeServer(o: { boot?: string; list?: boolean; pid?: string; schema?: boolean; exitCode?: number; shape?: 'empty' | 'badTools' | 'badCall' | 'emptyInit' | 'badSchema' | 'nullContent' | 'numberText' | 'stringIsError' | 'noVersion' | 'arraySchema' | 'bogusContent' | 'bareImage' | 'nullResource' | 'audioOk' | 'linkOk' | 'blobOk' | 'audioNoMime' | 'linkNoName' | 'resourceNoBody' } = {}): string {
  return `${o.pid ? `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(o.pid)}, String(process.pid));\n` : ''}${o.boot ? `console.log(${JSON.stringify(o.boot)});\n` : ''}
const reply = (id, result) => process.stdout.write(JSON.stringify(${o.shape === 'empty' ? '{ jsonrpc: \'2.0\', id }' : '{ jsonrpc: \'2.0\', id, result }'}) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id == null) continue;
    if (msg.method === 'initialize') reply(msg.id, ${o.shape === 'emptyInit' ? '{}' : o.shape === 'noVersion' ? "{ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake' } }" : "{ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } }"});
    else if (msg.method === 'tools/list') { if (${o.list === false ? 'false' : 'true'}) reply(msg.id, ${o.shape === 'badTools' ? "{ tools: 'nope' }" : `{ tools: [{ name: 't', description: 'd', inputSchema: { type: '${o.shape === 'arraySchema' ? 'array' : 'object'}' }${o.schema === false ? '' : o.shape === 'badSchema' ? ', outputSchema: 0' : ', outputSchema: { type: \'object\' }'} }] }`}); }
    else reply(msg.id, ${o.shape === 'badCall' ? '{}' : o.shape === 'nullContent' ? '{ content: [null] }' : o.shape === 'numberText' ? "{ content: [{ type: 'text', text: 123 }] }" : o.shape === 'stringIsError' ? "{ content: [{ type: 'text', text: 'ok' }], isError: 'true' }" : o.shape === 'bogusContent' ? "{ content: [{ type: 'bogus' }] }" : o.shape === 'bareImage' ? "{ content: [{ type: 'image' }] }" : o.shape === 'nullResource' ? "{ content: [{ type: 'resource', resource: null }] }" : o.shape === 'audioOk' ? "{ content: [{ type: 'audio', data: 'AA==', mimeType: 'audio/wav' }] }" : o.shape === 'linkOk' ? "{ content: [{ type: 'resource_link', uri: 'file:///a', name: 'a' }] }" : o.shape === 'blobOk' ? "{ content: [{ type: 'resource', resource: { uri: 'file:///a', blob: 'AA==' } }] }" : o.shape === 'audioNoMime' ? "{ content: [{ type: 'audio', data: 'AA==' }] }" : o.shape === 'linkNoName' ? "{ content: [{ type: 'resource_link', uri: 'file:///a' }] }" : o.shape === 'resourceNoBody' ? "{ content: [{ type: 'resource', resource: { uri: 'file:///a' } }] }" : "{ content: [{ type: 'text', text: 'ok' }], structuredContent: {} }"});
  }
});
process.stdin.on('end', () => process.exit(${o.exitCode ?? 0}));
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
    const noMcp = fakeRoot('process.exit(0);\n');
    rmSync(join(noMcp, 'packages/mcp/dist'), { recursive: true });
    const m = verify(['doctor', '--json', '--out', out()], { env: { VERIFY_ROOT: noMcp } });
    expect(m.r.status, 'a root with no mcp dist').toBe(1);
    expect((m.res?.checks ?? []).find((c) => c.name === 'mcp-dist')?.ok).toBe(false);
    expect((m.res?.checks ?? []).find((c) => c.name === 'mcp-dist')?.detail ?? '').toContain('packages/mcp/dist');
    const stale = fakeRoot('process.exit(0);\n', 'process.exit(0);\n', '0.0.0-stale');
    const v = verify(['doctor', '--json', '--out', out()], { env: { VERIFY_ROOT: stale } });
    expect(v.r.status, 'a dist whose --version differs from package.json').toBe(1);
    expect((v.res?.checks ?? []).find((c) => c.name === 'version')?.ok).toBe(false);
    expect((v.res?.checks ?? []).filter((c) => c.name !== 'version').every((c) => c.ok), 'only the version check fails').toBe(true);
    // the version child is a phase with a deadline: a dist that prints the version and hangs FAILs the check
    const hang = fakeRoot('process.exit(0);\n');
    writeFileSync(join(hang, 'packages/cli/dist/index.js'), `console.log(${JSON.stringify(VERSION)}); setTimeout(() => {}, 600000);\n`);
    const o = out();
    const h = verify(['doctor', '--json', '--out', o, '--timeout', '1'], { env: { VERIFY_ROOT: hang } });
    expect(h.r.status, 'a --version that hangs').toBe(1);
    const version = (h.res?.checks ?? []).find((c) => c.name === 'version');
    expect(version?.ok).toBe(false);
    expect(version?.detail ?? '').toMatch(/timed out/);
    expect(h.res?.timedOut).toBe(true);
    expect(h.res?.phases?.version?.timedOut).toBe(true);
    for (const f of ['doctor.version.txt', 'doctor.version.err', 'doctor.version.exit']) expect(readdirSync(o), f).toContain(f);
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
      ['a label with a dot (two labels\' files could coincide)', ['run', '--label', 'demo.main', '--offline', '--', 'team', 'mexico']],
      ['a capture label with a dot', ['capture', 'demo.main', '--', 'team', 'mexico']],
      ['an --env scenario key with an empty value', ['run', '--offline', '--env', 'CLAUDINHO_COMPETITION=', '--', 'team', 'mexico']],
      ['an --env scenario key with an empty value (prompt)', ['prompt', '--env', 'CLAUDINHO_TEAM=']],
      ['a --cache that is a file', ['prompt', '--cache', join(ROOT, 'package.json')]],
    ] as Array<[string, string[]]>) {
      const { r, res } = verify([args[0] as string, '--json', '--out', out(), ...args.slice(1)]);
      expect(r.status, why).toBe(2);
      expect(res?.phases ?? {}, why).toEqual({});
    }
    const seedFile = verify(['seed', 'none', '--cache', join(ROOT, 'package.json'), '--json']);
    expect(seedFile.r.status, 'a --cache that is a file (seed none, which takes no --out)').toBe(2);
    expect(seedFile.res?.error ?? '').toMatch(/not a directory/);
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
    expect(a.res?.fetches).toEqual([{ url: 'https://example.invalid/control', mode: 'offline', outcome: 'blocked', phase: 'main' }]);
    expect(a.res?.phases?.main?.stdout).toContain('done');
    const corpus = mkdtempSync(join(scratch, 'corpus-'));
    const b = verify(['run', '--json', '--out', out(), '--replay', corpus, '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(b.r.status).toBe(1);
    expect(b.res?.ok).toBe(false);
    expect(b.res?.phases?.main?.exit, 'the child\'s own exit is kept').toBe(0);
    expect((b.res?.fetches ?? []).map((f) => f.outcome)).toEqual(['miss']);
    expect((b.res?.failures ?? []).some((f) => /main.*miss/.test(f)), 'the failure names the phase').toBe(true);
    expect(existsSync(join(corpus, 'misses.log')), 'misses are run-owned, never the corpus\'s').toBe(false);
    expect(readdirSync(corpus), 'the corpus is never written').toEqual([]);
  });

  it('two concurrent runs with one label and directory: exactly one is refused', async () => {
    const o = out();
    const [a, b] = await Promise.all([
      verifyAsync(['run', '--json', '--out', o, '--label', 'twin', '--offline', '--', 'team', 'mexico']),
      verifyAsync(['run', '--json', '--out', o, '--label', 'twin', '--offline', '--', 'team', 'mexico']),
    ]);
    expect([a.r.status, b.r.status].sort()).toEqual([0, 2]);
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
    expect(new Set((ok.res?.fetches ?? []).map((f) => f.phase)), 'the main and the twin phase each logged their own').toEqual(new Set(['main', 'twin']));
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
    // the evidence never lands in the corpus
    for (const o of [corpus, join(corpus, 'evidence')]) {
      const inside = verify(['run', '--json', '--out', o, '--replay', corpus, '--', 'team', 'mexico']);
      expect(inside.r.status, `--out ${o}`).toBe(2);
      expect(inside.res?.phases ?? {}).toEqual({});
    }
    const dflt = verify(['run', '--json', '--replay', corpus, '--', 'team', 'mexico'], { env: { TMPDIR: corpus } });
    expect(dflt.r.status, 'the default evidence directory would sit inside the corpus').toBe(2);
    expect(dflt.res?.error ?? '').toMatch(/inside the replay corpus/);
    expect(existsSync(join(corpus, 'claudinho-verify')), 'nothing made under the corpus').toBe(false);
    const homesIn = verify(['run', '--json', '--out', out(), '--replay', corpus, '--keep', '--', 'team', 'mexico'], { env: { TMPDIR: corpus } });
    expect(homesIn.r.status, 'the temporary root would sit inside the corpus').toBe(2);
    expect(homesIn.res?.error ?? '').toMatch(/temporary root .* is inside the replay corpus/);
    expect(readdirSync(corpus).some((f) => f.startsWith('claudinho-verify')), 'no temporary root under the corpus').toBe(false);
    expect(readdirSync(corpus).some((f) => f.endsWith('.result.json')), 'nothing written into the corpus').toBe(false);
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
    expect((today.res?.fetches ?? []).every((f) => f.outcome === 'blocked' && f.phase === 'server')).toBe(true);
    expect(today.res?.exit, 'the server exited on its own').toBe(0);
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
    // the server's own exit is part of ok
    const seven = fakeRoot('process.exit(0);\n', fakeServer({ exitCode: 7 }));
    const x = verify(['mcp', '--json', '--out', out(), '--list'], { env: { VERIFY_ROOT: seven } });
    expect(x.res?.ok, 'a valid session whose server exits 7').toBe(false);
    expect(x.r.status).toBe(1);
    expect(x.res?.exit).toBe(7);
    expect((x.res?.failures ?? []).some((f) => /server exit 7/.test(f))).toBe(true);
    // a reply is judged before it is believed
    const empty = fakeRoot('process.exit(0);\n', fakeServer({ shape: 'empty' }));
    const e = verify(['mcp', '--json', '--out', out(), '--list'], { env: { VERIFY_ROOT: empty } });
    expect(e.res?.ok, 'a reply with neither result nor error').toBe(false);
    expect(e.r.status).toBe(1);
    expect(e.res?.error ?? '').toMatch(/malformed reply to initialize/);
    const badTools = fakeRoot('process.exit(0);\n', fakeServer({ shape: 'badTools' }));
    const bt = verify(['mcp', '--json', '--out', out(), '--list'], { env: { VERIFY_ROOT: badTools } });
    expect(bt.res?.ok, 'tools that are not an array').toBe(false);
    expect(bt.res?.error ?? '').toMatch(/malformed reply to tools\/list/);
    const badCall = fakeRoot('process.exit(0);\n', fakeServer({ shape: 'badCall' }));
    const bc = verify(['mcp', '--json', '--out', out(), 't'], { env: { VERIFY_ROOT: badCall } });
    expect(bc.res?.ok, 'a call result without content').toBe(false);
    expect(bc.res?.error ?? '').toMatch(/malformed reply to tools\/call/);
    // the BODIES are judged too
    for (const [shape, argv, step] of [
      ['emptyInit', ['--list'], 'initialize'],
      ['badSchema', ['--list'], 'tools/list'],
      ['nullContent', ['t'], 'tools/call'],
      ['numberText', ['t'], 'tools/call'],
      ['stringIsError', ['t'], 'tools/call'],
      ['noVersion', ['--list'], 'initialize'],
      ['arraySchema', ['--list'], 'tools/list'],
      ['bogusContent', ['t'], 'tools/call'],
      ['bareImage', ['t'], 'tools/call'],
      ['nullResource', ['t'], 'tools/call'],
      ['audioNoMime', ['t'], 'tools/call'],
      ['linkNoName', ['t'], 'tools/call'],
      ['resourceNoBody', ['t'], 'tools/call'],
    ] as Array<['emptyInit' | 'badSchema' | 'nullContent' | 'numberText' | 'stringIsError' | 'noVersion' | 'arraySchema' | 'bogusContent' | 'bareImage' | 'nullResource' | 'audioNoMime' | 'linkNoName' | 'resourceNoBody', string[], string]>) {
      const root = fakeRoot('process.exit(0);\n', fakeServer({ shape }));
      const v = verify(['mcp', '--json', '--out', out(), ...argv], { env: { VERIFY_ROOT: root } });
      expect(v.res?.ok, shape).toBe(false);
      expect(v.r.status, shape).toBe(1);
      expect(v.res?.error ?? '', shape).toContain(`malformed reply to ${step}`);
    }
    // the grammar's other valid items pass
    for (const shape of ['audioOk', 'linkOk', 'blobOk'] as const) {
      const root = fakeRoot('process.exit(0);\n', fakeServer({ shape }));
      const v = verify(['mcp', '--json', '--out', out(), 't'], { env: { VERIFY_ROOT: root } });
      expect(v.res?.ok, `${shape}: ${v.res?.error}`).toBe(true);
    }
    const pf = pidFile();
    const root = fakeRoot('process.exit(0);\n', fakeServer({ list: false, pid: pf }));
    const { r, res } = verify(['mcp', '--json', '--out', out(), '--timeout', '2', '--list'], { env: { VERIFY_ROOT: root }, timeout: 20_000 });
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
    for (const f of ['ev.main.txt', 'ev.main.err', 'ev.main.exit', 'ev.main.spawns', 'ev.main.fetches', 'ev.twin.txt', 'ev.twin.err', 'ev.twin.exit', 'ev.twin.spawns', 'ev.twin.fetches', 'ev.result.json']) expect(files, f).toContain(f);
    expect(files).not.toContain('ev.fetches');
    expect(readFileSync(join(o, 'ev.main.exit'), 'utf8').trim()).toBe('1');
    expect(readFileSync(join(o, 'ev.twin.txt'), 'utf8')).toMatch(/"noCompetition": true/);
    expect(readFileSync(join(o, 'ev.main.err'), 'utf8')).toMatch(/No competition chosen/);
    expect(readFileSync(join(o, 'ev.main.fetches'), 'utf8')).toBe('');
    const aggregate = JSON.parse(readFileSync(join(o, 'ev.result.json'), 'utf8'));
    expect(aggregate.ok).toBe(false);
    expect(aggregate.pending, 'the aggregate replaced the pending object').toBeUndefined();
    expect(aggregate.phases?.main?.exit).toBe(1);
    // the label is reserved: a second run with the same label and directory is refused and the first's files stand
    const before = Object.fromEntries(files.map((f) => [f, readFileSync(join(o, f), 'utf8')]));
    const again = verify(['run', '--json', '--out', o, '--label', 'ev', '--offline', '--', 'team', 'mexico']);
    expect(again.r.status, 'a taken label').toBe(2);
    expect(again.res?.error ?? '').toMatch(/taken/);
    for (const [f, text] of Object.entries(before)) expect(readFileSync(join(o, f), 'utf8'), f).toBe(text);
    expect(readdirSync(o).sort()).toEqual(files.sort());
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
    const { r, res } = verify(['run', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root }, timeout: 20_000 });
    expect(r.status).toBe(1);
    expect(res?.ok).toBe(false);
    expect(res?.timedOut).toBe(true);
    expect(res?.phases?.main?.timedOut).toBe(true);
    expect(res?.phases?.main?.stdout).toContain('started');
    expect(await until(() => !pidAlive(readPid(pf)), 3000), 'the child was reaped').toBe(true);
    const polite = fakeRoot(`process.on('SIGTERM', () => { console.log('term'); process.exit(3); }); console.log('up'); setTimeout(() => {}, 600000);\n`);
    const t = verify(['run', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: polite }, timeout: 20_000 });
    expect(t.res?.timedOut).toBe(true);
    expect(t.res?.phases?.main?.exit, 'TERM first: the handler exited 3 before any KILL').toBe(3);
    expect(t.res?.phases?.main?.stdout).toContain('term');
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
    expect(readFileSync(join(o, 'cap.main.err'), 'utf8'), 'a capture that ended on its own says nothing about its group').not.toMatch(/verify: the group/);
    expect(good.res?.env ?? []).not.toContain('NO_COLOR');
    const status = fakeRoot("console.log('seven'); process.exit(7);\n");
    const seven = verify(['capture', 'seven', '--json', '--out', out(), '--', 'today'], { env: { VERIFY_ROOT: status } });
    expect(seven.res?.phases?.main?.exit, 'the child\'s status is the capture\'s').toBe(7);
    expect(seven.res?.ok).toBe(false);
    const pf = pidFile();
    // ignoring TERM and HUP both: only the KILL of the recorded descendants ends it (the pty's hangup cannot)
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const o2 = out();
    const hung = verify(['capture', 'hang', '--json', '--out', o2, '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root }, timeout: 20_000 });
    expect(hung.r.status).toBe(1);
    expect(hung.res?.ok).toBe(false);
    expect(hung.res?.timedOut).toBe(true);
    expect(await until(() => existsSync(pf), 3000)).toBe(true);
    expect(await until(() => !pidAlive(readPid(pf)), 5000), 'the TERM-and-HUP-ignoring child under script is gone').toBe(true);
    expect(existsSync(join(o2, 'hang.ansi')), 'the partial transcript is kept').toBe(true);
    expect(readFileSync(join(o2, 'hang.txt'), 'utf8')).toContain('hanging');
  });

  it('capture: a ps that never answers cannot hold the deadline; the kill proceeds and the stderr says so', { timeout: SLOW }, async () => {
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const ps = stubTool('ps', 'sleep 30');
    const o = out();
    const r = verify(['capture', 'ps', '--json', '--out', o, '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root, PATH: withTool(ps) }, timeout: 25_000 });
    expect(r.res, `the wrapper returned: ${r.stderr.slice(0, 200)}`).not.toBeNull();
    expect(r.res?.timedOut).toBe(true);
    expect(readFileSync(join(o, 'ps.main.err'), 'utf8')).toMatch(/ps did not answer/);
    expect((r.res?.failures ?? []).some((f) => /may have survived/.test(f)), 'a ps that never answered: the result says a descendant may have survived').toBe(true);
    expect(await until(() => !pidAlive(readPid(pf)), 5000), 'the child is gone (the pty hung up when script died)').toBe(true);
    // a ps that ignores TERM is killed hard at its bound
    const pf2 = pidFile();
    const root2 = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf2)}, String(process.pid)); process.on('SIGTERM', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const stubborn = stubTool('ps', "trap '' TERM; sleep 30");
    const r2 = verify(['capture', 'ps2', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root2, PATH: withTool(stubborn) }, timeout: 25_000 });
    expect(r2.res, 'the wrapper returned although ps ignores TERM').not.toBeNull();
    expect(r2.res?.timedOut).toBe(true);
    expect(await until(() => !pidAlive(readPid(pf2)), 5000)).toBe(true);
  });

  it('capture: a ps that fails at TERM and answers at KILL still reaps the descendants; one that never answers leaves a survivor the result names', { timeout: SLOW }, async () => {
    // a child that ignores TERM and HUP: only the KILL of a recorded descendant ends it
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const marker = join(scratch, `ps-once-${++n}`);
    const once = stubTool('ps', `if [ ! -e "${marker}" ]; then : > "${marker}"; sleep 30; else exec /bin/ps "$@"; fi`);
    const a = verify(['capture', 'once', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root, PATH: withTool(once) }, timeout: 40_000 });
    expect(a.res, a.stderr.slice(0, 200)).not.toBeNull();
    expect(a.res?.timedOut).toBe(true);
    expect(existsSync(marker), 'ps was asked at TERM').toBe(true);
    expect(await until(() => !pidAlive(readPid(pf)), 5000), 'ps answered at KILL: the descendant was reaped').toBe(true);
    expect((a.res?.failures ?? []).some((f) => /may have survived/.test(f)), 'no survivor line when the second ps answered').toBe(false);
    const pf2 = pidFile();
    const root2 = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf2)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const never = stubTool('ps', 'sleep 30');
    const b = verify(['capture', 'never', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root2, PATH: withTool(never) }, timeout: 40_000 });
    expect(b.res).not.toBeNull();
    expect(b.res?.ok).toBe(false);
    expect((b.res?.failures ?? []).some((f) => /main: ps did not answer; a descendant may have survived/.test(f)), 'the survivor is said').toBe(true);
    expect(await until(() => existsSync(pf2), 3000)).toBe(true);
    const orphan = readPid(pf2);
    expect(pidAlive(orphan), 'the survivor the result named is alive').toBe(true);
    try { process.kill(orphan, 'SIGKILL'); } catch { /* already gone */ }
    expect(await until(() => !pidAlive(orphan), 5000), 'the test reaped the survivor itself').toBe(true);
  });

  it('capture: a second ps vouches only for a leader still alive; a leader that died during the withheld grace leaves a survivor the result names', { timeout: SLOW }, async () => {
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    // a script that starts its command in its OWN SESSION (as script does) and leaves during the grace: the child is reparented before the second ps and no group signal can reach it
    const leaving = stubTool('script', [
      'if [ "$2" = "-F" ]; then f=$3; shift 3; ( perl -e \'use POSIX qw(setsid); setsid(); exec @ARGV\' -- "$@" > "$f" 2>&1 & ); else f=$6; cmd=$5; ( perl -e \'use POSIX qw(setsid); setsid(); exec @ARGV\' -- sh -c "$cmd" > "$f" 2>&1 & ); fi',
      'sleep 1.5',
      'exit 0',
    ].join('\n'));
    const marker = join(scratch, `ps-once-${++n}`);
    const once = stubTool('ps', `if [ ! -e "${marker}" ]; then : > "${marker}"; sleep 30; else exec /bin/ps "$@"; fi`);
    const r = verify(['capture', 'left', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root, PATH: `${leaving}:${withTool(once)}` }, timeout: 40_000 });
    expect(r.res, r.stderr.slice(0, 200)).not.toBeNull();
    expect(existsSync(marker), 'ps was asked at the deadline and failed').toBe(true);
    expect(await until(() => existsSync(pf), 3000)).toBe(true);
    expect((r.res?.failures ?? []).some((f) => /the group's leader was gone before ps could vouch; a descendant may have survived/.test(f)), 'the leader was gone at the KILL step: the second ps vouches for nothing, and the line says why').toBe(true);
    expect(r.res?.phases?.main?.survivorReason).toMatch(/leader was gone/);
    const orphan = readPid(pf);
    expect(pidAlive(orphan), 'the survivor the result named is alive').toBe(true);
    try { process.kill(orphan, 'SIGKILL'); } catch { /* already gone */ }
    expect(await until(() => !pidAlive(orphan), 5000)).toBe(true);
    // the leader leaves DURING the second lookup: the snapshot shows it gone (or a zombie) and vouches for nothing
    const pfd = pidFile();
    const rootd = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pfd)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const leavingLate = stubTool('script', [
      'if [ "$2" = "-F" ]; then f=$3; shift 3; ( perl -e \'use POSIX qw(setsid); setsid(); exec @ARGV\' -- "$@" > "$f" 2>&1 & ); else f=$6; cmd=$5; ( perl -e \'use POSIX qw(setsid); setsid(); exec @ARGV\' -- sh -c "$cmd" > "$f" 2>&1 & ); fi',
      'sleep 9',
      'exit 0',
    ].join('\n'));
    const markerd = join(scratch, `ps-once-${++n}`);
    const slowSecond = stubTool('ps', `if [ ! -e "${markerd}" ]; then : > "${markerd}"; sleep 30; else sleep 2; exec /bin/ps "$@"; fi`);
    const d = verify(['capture', 'during', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: rootd, PATH: `${leavingLate}:${withTool(slowSecond)}` }, timeout: 40_000 });
    expect(d.res, d.stderr.slice(0, 200)).not.toBeNull();
    expect(await until(() => existsSync(pfd), 3000)).toBe(true);
    expect((d.res?.failures ?? []).some((f) => /the group's leader was gone before ps could vouch; a descendant may have survived/.test(f)), 'the leader left while the second ps ran: the snapshot vouches for nothing, and the line says why').toBe(true);
    const orphand = readPid(pfd);
    expect(pidAlive(orphand), 'the survivor the result named is alive').toBe(true);
    try { process.kill(orphand, 'SIGKILL'); } catch { /* already gone */ }
    expect(await until(() => !pidAlive(orphand), 5000)).toBe(true);
    // the leader leaves DURING THE FIRST lookup: that snapshot vouches for nothing either, the deadline counts as unrecorded
    const pff = pidFile();
    const rootf = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pff)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const leavingEarly = stubTool('script', [
      'if [ "$2" = "-F" ]; then f=$3; shift 3; ( perl -e \'use POSIX qw(setsid); setsid(); exec @ARGV\' -- "$@" > "$f" 2>&1 & ); else f=$6; cmd=$5; ( perl -e \'use POSIX qw(setsid); setsid(); exec @ARGV\' -- sh -c "$cmd" > "$f" 2>&1 & ); fi',
      'sleep 1.3',
      'exit 0',
    ].join('\n'));
    const markerf = join(scratch, `ps-once-${++n}`);
    const slowFirst = stubTool('ps', `if [ ! -e "${markerf}" ]; then : > "${markerf}"; sleep 2; fi; exec /bin/ps "$@"`);
    const f = verify(['capture', 'first', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: rootf, PATH: `${leavingEarly}:${withTool(slowFirst)}` }, timeout: 40_000 });
    expect(f.res, f.stderr.slice(0, 200)).not.toBeNull();
    expect(await until(() => existsSync(pff), 3000)).toBe(true);
    expect((f.res?.failures ?? []).some((x) => /the group's leader was gone before ps could vouch; a descendant may have survived/.test(x)), 'the leader left while the first ps ran: that snapshot vouches for nothing, and the line says why').toBe(true);
    expect(f.res?.phases?.main?.stderr ?? '').toMatch(/leader was (zombie|absent)/);
    const orphanf = readPid(pff);
    expect(pidAlive(orphanf), 'the survivor the result named is alive').toBe(true);
    try { process.kill(orphanf, 'SIGKILL'); } catch { /* already gone */ }
    expect(await until(() => !pidAlive(orphanf), 5000)).toBe(true);
  });

  it('capture: a member of the leader\'s own group outside any recorded tree is reached by the group signal while the group exists, after the leader\'s own death too', { timeout: SLOW }, async () => {
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('member'); setTimeout(() => {}, 600000);\n`);
    // a script that starts its command in its OWN GROUP (no new session) through a subshell that exits at once, so the
    // member is reparented before the deadline and no recorded tree holds it; the script then outlives the deadline
    const grouped = stubTool('script', [
      'if [ "$2" = "-F" ]; then f=$3; shift 3; ( "$@" > "$f" 2>&1 & ); else f=$6; cmd=$5; ( sh -c "$cmd" > "$f" 2>&1 & ); fi',
      'sleep 30',
    ].join('\n'));
    const r = verify(['capture', 'member', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: { VERIFY_ROOT: root, PATH: withTool(grouped) }, timeout: 40_000 });
    expect(r.res, r.stderr.slice(0, 200)).not.toBeNull();
    expect(r.res?.timedOut).toBe(true);
    expect(await until(() => existsSync(pf), 3000)).toBe(true);
    expect(await until(() => !pidAlive(readPid(pf)), 5000), 'the member died by the group signal after the leader did').toBe(true);
    expect((r.res?.failures ?? []).some((f) => /may have survived/.test(f)), 'no survivor line: the group was reached').toBe(false);
  });

  it('capture: a second interrupt kills every running capture\'s group and recorded tree before leaving, and says when a descendant may have survived', { timeout: SLOW }, async () => {
    const interruptTwice = (pf: string, env: Record<string, string>) =>
      new Promise<{ status: number | null; stderr: string; child: ChildProcess }>((done) => {
        const child = spawn(process.execPath, [VERIFY, 'capture', 'int', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: testEnv(env), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr?.on('data', (d) => { stderr += d; });
        child.on('close', (status) => done({ status, stderr, child }));
        (async () => {
          await until(() => existsSync(pf), 5000);
          await new Promise((t) => setTimeout(t, 1500)); // past the deadline: the controller is in its abort
          child.kill('SIGINT');
          await new Promise((t) => setTimeout(t, 300));
          child.kill('SIGINT');
        })();
      });
    const pf = pidFile();
    const root = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const a = await interruptTwice(pf, { VERIFY_ROOT: root });
    expect(a.status, 'the second interrupt exits 130').toBe(130);
    expect(await until(() => !pidAlive(readPid(pf)), 5000), 'with a working ps the recorded tree was killed before leaving').toBe(true);
    const pf2 = pidFile();
    const root2 = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf2)}, String(process.pid)); process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const never = stubTool('ps', 'sleep 30');
    const b = await interruptTwice(pf2, { VERIFY_ROOT: root2, PATH: withTool(never) });
    expect(b.status).toBe(130);
    expect(b.stderr).toMatch(/interrupted twice; a capture's descendants may have survived/);
    const orphan = readPid(pf2);
    expect(pidAlive(orphan), 'the survivor the result named is alive').toBe(true);
    try { process.kill(orphan, 'SIGKILL'); } catch { /* already gone */ }
    expect(await until(() => !pidAlive(orphan), 5000)).toBe(true);
    // a plain child (no group) that ignores TERM is killed by the second interrupt too
    const pf3 = pidFile();
    const root3 = fakeRoot(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pf3)}, String(process.pid)); process.on('SIGTERM', () => {}); console.log('hanging'); setTimeout(() => {}, 600000);\n`);
    const plain = await new Promise<{ status: number | null }>((done) => {
      const child = spawn(process.execPath, [VERIFY, 'run', '--json', '--out', out(), '--timeout', '1', '--offline', '--', 'today'], { env: testEnv({ VERIFY_ROOT: root3 }), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('close', (status) => done({ status }));
      (async () => {
        await until(() => existsSync(pf3), 5000);
        await new Promise((t) => setTimeout(t, 1500));
        child.kill('SIGINT');
        await new Promise((t) => setTimeout(t, 300));
        child.kill('SIGINT');
      })();
    });
    expect(plain.status).toBe(130);
    expect(await until(() => !pidAlive(readPid(pf3)), 5000), 'the plain child was killed before the controller left').toBe(true);
  });

  it('capture: script\'s own header and footer lines leave the .txt and stay in the .ansi', () => {
    const script = stubTool('script', [
      'if [ "$2" = "-F" ]; then f=$3; shift 3; cmd="$*"; else f=$6; cmd=$5; fi',
      'echo "Script started on 2026-10-07 19:00:00+00:00 [COMMAND=\\"$cmd\\"]" > "$f"',
      'if [ "$2" = "-F" ]; then "$@" >> "$f" 2>&1; rc=$?; else sh -c "$cmd" >> "$f" 2>&1; rc=$?; fi',
      'echo "Script done on 2026-10-07 19:00:01+00:00 [COMMAND_EXIT_CODE=\\"$rc\\"]" >> "$f"',
      'exit $rc',
    ].join('\n'));
    const o = out();
    const r = verify(['capture', 'hdr', '--json', '--out', o, '--offline', '--', 'team', 'mexico'], { env: { PATH: withTool(script) } });
    expect(r.r.status, r.res?.error).toBe(0);
    const txt = readFileSync(join(o, 'hdr.txt'), 'utf8');
    expect(txt).toContain('Mexico');
    expect(txt).not.toMatch(/Script (started|done) on/);
    expect(readFileSync(join(o, 'hdr.ansi'), 'utf8')).toMatch(/Script started on/);
  });

  it('every launch function of child_process is recorded and starts nothing', () => {
    const root = fakeRoot(`import { exec, execFile, execSync, spawnSync, fork } from 'node:child_process';
execFile('echo', ['a'], (e, o) => console.log('cbfile', JSON.stringify(String(o))));
exec('echo b', (e, o) => console.log('cbexec', JSON.stringify(String(o))));
console.log('sync', JSON.stringify(String(execSync('echo c'))));
const r = spawnSync('echo', ['d']); console.log('spawnsync', r.status, JSON.stringify(String(r.stdout ?? '')));
fork(new URL('./child.js', import.meta.url).pathname);
setTimeout(() => {}, 200);
`);
    writeFileSync(join(root, 'packages/cli/dist/child.js'), "console.log('forked');\n");
    const { r, res } = verify(['run', '--json', '--out', out(), '--offline', '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(r.status, res?.phases?.main?.stderr).toBe(0);
    expect((res?.spawns ?? []).map((s) => (s as string[])[0])).toEqual(['echo', 'echo b', 'echo c', 'echo', join(realpathSync(root), 'packages/cli/dist/child.js')]);
    const stdout = res?.phases?.main?.stdout ?? '';
    expect(stdout).toContain('cbfile ""');
    expect(stdout).toContain('cbexec ""');
    expect(stdout).toContain('sync ""');
    expect(stdout).toContain('spawnsync 0 ""');
    expect(stdout).not.toContain('forked');
  });

  it('a preload that cannot write its log says so on stderr and the phase fails; the live preload logs the attempt first', () => {
    const missing = join(scratch, 'no-such-dir', 'fetches');
    const corpus = mkdtempSync(join(scratch, 'corpus-'));
    const stub = join(mkdtempSync(join(scratch, 'stub-'))), stub503 = join(stub, 'stub503.mjs'), never = join(stub, 'never.mjs');
    writeFileSync(stub503, "globalThis.fetch = async () => new Response('x', { status: 503 });\n");
    writeFileSync(never, "globalThis.fetch = () => new Promise(() => {}); setTimeout(() => process.exit(0), 300);\n");
    const probe = "try { const r = await fetch('https://example.invalid/p'); console.log('status', r.status); } catch (e) { console.log('rejected', e.message); }";
    const run = (imports: string[], env: Record<string, string>) => spawnSync(process.execPath, [...imports.flatMap((i) => ['--import', i]), '--input-type=module', '-e', probe], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 20_000 });
    const off = run([PRELOADS.offline], { VERIFY_FETCH_LOG: missing });
    expect(off.stderr).toMatch(/verify-preload: could not record blocked for https:\/\/example\.invalid\/p/);
    expect(off.stdout).toContain('rejected');
    const rep = run([PRELOADS.replay], { VERIFY_FETCH_LOG: missing, VERIFY_REPLAY_CORPUS: corpus });
    expect(rep.stderr).toMatch(/verify-preload: could not record miss for/);
    expect(rep.stdout).toContain('rejected');
    const live = run([stub503, PRELOADS.live], { VERIFY_FETCH_LOG: missing });
    expect(live.stderr).toMatch(/verify-preload: could not record live:sent for/);
    expect(live.stdout).toContain('status 503');
    // the live preload, with a log: the attempt before the request, the status after; a request that never settles leaves the attempt
    const log = join(mkdtempSync(join(scratch, 'live-')), 'fetches');
    writeFileSync(log, '');
    run([stub503, PRELOADS.live], { VERIFY_FETCH_LOG: log });
    expect(jsonLines(log)).toEqual([{ url: 'https://example.invalid/p', mode: 'live', outcome: 'live:sent' }, { url: 'https://example.invalid/p', mode: 'live', outcome: 'live:503' }]);
    writeFileSync(log, '');
    run([never, PRELOADS.live], { VERIFY_FETCH_LOG: log });
    expect(jsonLines(log)).toEqual([{ url: 'https://example.invalid/p', mode: 'live', outcome: 'live:sent' }]);
    // the controller fails a phase whose stderr carries the marker
    const root = fakeRoot("process.stderr.write('verify-preload: could not record blocked for https://x/: boom\\n'); console.log('done');\n");
    const { r, res } = verify(['run', '--json', '--out', out(), '--offline', '--', 'today'], { env: { VERIFY_ROOT: root } });
    expect(r.status).toBe(1);
    expect(res?.ok).toBe(false);
    expect((res?.failures ?? []).some((f) => /could not be recorded/.test(f))).toBe(true);
  });

  it('the two SKILL.md copies are byte-equal and both name the one map; the map has the five surfaces; every cited AGENTS.md lead exists', () => {
    const agents = readFileSync(AGENTS, 'utf8');
    const cited = [SKILL, ...readdirSync(FEATURES).map((f) => join(FEATURES, f))].map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const lead of CITED_LEADS) {
      expect(agents, `AGENTS.md has the lead "${lead}"`).toContain(lead);
      expect(cited, `the skill or the map cites "${lead}"`).toContain(`"${lead}"`);
    }
    expect(cited, 'no bullet is cited by a nickname').not.toMatch(/the \w+(-\w+)? bullets?\b/);
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
  it('reads twelve lines, at least one per feature file, each naming a command --help lists', () => {
    expect(lines.length, 'the map grows by a deliberate change of this number').toBe(12);
    for (const f of ['live.md', 'next.md', 'statusline.md', 'table.md', 'today.md']) expect(lines.some((l) => l.file === f), `${f} drives something`).toBe(true);
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
