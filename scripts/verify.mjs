#!/usr/bin/env node
/**
 * The control CLI of the verify-claudinho skill (`.claude/skills/verify-claudinho/SKILL.md`): it drives the REAL
 * built binary (`packages/cli/dist`, `packages/mcp/dist`; `pnpm -r build` first) one surface at a time, in an
 * environment BUILT FROM SCRATCH for every child, offline by default, and keeps the evidence of every child it ran.
 *
 *   node scripts/verify.mjs --help
 *
 * Every child (the bootstrap `follow`, the main command, the `--json` twin, the capture, the MCP server, the hook)
 * gets PATH; a temporary HOME (and USERPROFILE, APPDATA, LOCALAPPDATA on Windows); absolute temporary
 * XDG_CONFIG_HOME and XDG_CACHE_HOME; the run's TMPDIR; TZ=UTC; LANG=en_US.UTF-8; CLAUDINHO_NO_STAR=1; NO_COLOR=1
 * (not under `capture`); NODE_OPTIONS loading the mode's fetch preload and `spawn-count.mjs` by absolute path, quoted;
 * QA_SPAWN_LOG and VERIFY_FETCH_LOG naming the run's evidence; the replay corpus in replay mode; and the `--env`
 * pairs, which take only the scenario keys. Nothing else of the operator's environment reaches a child.
 *
 * The output: with `--json`, stdout is ONE JSON object and every human line goes to stderr. The exit: 0 when `ok`;
 * 1 when a phase failed (a nonzero child, a replay miss, a malformed recording, a timeout, an MCP failure); 2 for a
 * usage error or a refusal before any child. The tree under test is the repository this script lives in, or
 * VERIFY_ROOT from the controller's own environment.
 *
 * Plain Node: no dependency beyond Node's builtins and `./statusline-seed.mjs` (the one cache seed).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedClub, stateFileName } from './statusline-seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.VERIFY_ROOT ? resolve(process.env.VERIFY_ROOT) : resolve(HERE, '..');
const CLI_REL = 'packages/cli/dist/index.js';
const MCP_REL = 'packages/mcp/dist/index.js';
const CLI = join(ROOT, CLI_REL);
const MCP = join(ROOT, MCP_REL);
const PRELOADS = {
  offline: join(HERE, 'offline-preload.mjs'),
  replay: join(HERE, 'replay-preload.mjs'),
  live: join(HERE, 'live-preload.mjs'),
};
const SPAWN_COUNT = join(HERE, 'spawn-count.mjs');
const WINDOWS = process.platform === 'win32';

/** The keys a scenario may set with `--env`; every other key (the harness's own included) is refused. */
const SCENARIO_KEYS = ['CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'CLAUDINHO_SOURCE', 'CLAUDINHO_MARKETS_SOURCE', 'LANG', 'TZ'];
/** The CLI commands `run` never starts: they write the operator's settings, or are the product's own internals. */
const REFUSED_COMMANDS = new Set(['init', 'init-statusline', 'init-hook', 'init-cursor-statusline', 'claude', 'cursor', 'star', '_refresh']);
/** The CLI's global options that take a value, skipped when looking for the subcommand in a child argv. */
const CLI_VALUE_OPTIONS = new Set(['--lang', '--tz', '-c', '--competition', '--source', '--flavor']);
const DEFAULT_TIMEOUT_S = 60;
const DEFAULT_MCP_TIMEOUT_S = 30;
const GRACE_MS = 2000;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SLUG = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

const HELP = `usage: node scripts/verify.mjs <command> [options]

Drives the built Claudinho binary (pnpm -r build first) in an environment built from scratch,
offline by default, and keeps the evidence of every child under --out.

commands:
  doctor                                    the dists, the version, a temporary config and cache; reports CLAUDINHO_COMPETITION and CLAUDINHO_TEAM
  run [mode] [--follow <alias>] [--twin] -- <argv...>
                                            the CLI's command (phase main), after its own follow (phase follow), and again with --json (phase twin)
  mcp [mode] [--follow <alias>] <tool> [<json arguments>]
  mcp [mode] --list                         one real stdio session: initialize, initialized, tools/list, then tools/call
  seed club --slug <slug> --cache <dir>     the one seed (Arsenal 2-1 Chelsea at 50', stamped now) under an absolute cache home
  seed none --cache <dir>                   an empty cache directory and nothing else
  prompt [--seed club --slug <slug> | --seed none] [--follow <alias>] [--cache <dir>]
                                            the statusline on that cache home, stdin at EOF
  hook [--seed club --slug <slug> | --seed none] [--follow <alias>] [--cache <dir>]
                                            the hook, the same way
  replay <corpus> [--synthetic] [--follow <alias>] [--twin] -- <argv...>
                                            run --replay <corpus>
  capture <label> [mode] [--follow <alias>] -- <argv...>
                                            run's main phase with colour on under a pty (Darwin, Linux): <label>.ansi and <label>.txt

modes (one at most):
  --offline                                 the default: every fetch fails at once with a network error, recorded as blocked
  --replay <corpus>                         the parity format, <sha256(url) first 24>.json; --synthetic serves synthetic/ first
  --live                                    the real provider, for a person on purpose (never an agent mid-task)

options:
  --json                                    stdout is one JSON object; human lines go to stderr
  --out <dir>                               the evidence directory (default <TMPDIR>/claudinho-verify/<timestamp>), never removed
  --label <name>                            the evidence files' prefix (default: the command)
  --keep                                    keep the temporary HOME, config and cache
  --timeout <seconds>                       each child's deadline (default 60; the MCP session 30)
  --env KEY=VALUE                           a scenario key only: ${SCENARIO_KEYS.join(', ')}
  --dry-run                                 seed: say what would be written, write nothing

refused before any child: the install commands (init, init-statusline, init-hook, init-cursor-statusline,
claude, cursor), star, _refresh, any --copy, and an --env key that is not a scenario key.
exit: 0 ok; 1 a phase failed (a nonzero child, a miss, a malformed recording, a timeout, an MCP failure); 2 usage.
`;

class UsageError extends Error {}
const refuse = (message) => new UsageError(`refused: ${message}`);

// ───────────────────────────── arguments ─────────────────────────────

const VALUE_OPTIONS = new Set(['--out', '--label', '--follow', '--replay', '--env', '--timeout', '--slug', '--cache', '--seed']);
const FLAG_OPTIONS = new Set(['--json', '--offline', '--live', '--twin', '--keep', '--synthetic', '--dry-run', '--list']);
const MODE_OPTIONS = ['--offline', '--replay', '--live'];
const ALLOWED = {
  doctor: ['--json', '--out', '--label'],
  run: ['--json', '--out', '--label', '--offline', '--replay', '--live', '--synthetic', '--follow', '--twin', '--keep', '--timeout', '--env'],
  replay: ['--json', '--out', '--label', '--offline', '--replay', '--live', '--synthetic', '--follow', '--twin', '--keep', '--timeout', '--env'],
  capture: ['--json', '--out', '--offline', '--replay', '--live', '--synthetic', '--follow', '--keep', '--timeout', '--env'],
  mcp: ['--json', '--out', '--label', '--offline', '--replay', '--live', '--synthetic', '--follow', '--keep', '--timeout', '--env', '--list'],
  seed: ['--json', '--slug', '--cache', '--dry-run'],
  prompt: ['--json', '--out', '--label', '--seed', '--slug', '--follow', '--cache', '--keep', '--timeout', '--env'],
  hook: ['--json', '--out', '--label', '--seed', '--slug', '--follow', '--cache', '--keep', '--timeout', '--env'],
};

/**
 * Splits a command's arguments: the options before `--` (in any order, each value option taking the next token),
 * the positionals before `--`, and the child argv after it. An unknown or misplaced option is a usage error.
 */
function parseArgs(command, args) {
  const allowed = new Set(ALLOWED[command]);
  const opts = { env: [], modes: [] };
  const positionals = [];
  let childArgv = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      childArgv = args.slice(i + 1);
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (!VALUE_OPTIONS.has(name) && !FLAG_OPTIONS.has(name)) throw refuse(`${command}: unknown option ${name}`);
      if (!allowed.has(name)) throw refuse(`${command} takes no ${name}`);
      if (FLAG_OPTIONS.has(name)) {
        if (eq > 0) throw refuse(`${name} takes no value`);
        if (MODE_OPTIONS.includes(name)) opts.modes.push(name);
        opts[name.slice(2)] = true;
        continue;
      }
      let value;
      if (eq > 0) value = a.slice(eq + 1);
      else {
        if (i + 1 >= args.length) throw refuse(`${name} needs a value`);
        value = args[++i];
      }
      if (name === '--env') opts.env.push(value);
      else if (name === '--replay') {
        opts.modes.push('--replay');
        opts.replay = value;
      } else {
        if (opts[name.slice(2)] !== undefined) throw refuse(`${name} given twice`);
        opts[name.slice(2)] = value;
      }
      continue;
    }
    positionals.push(a);
  }
  return { opts, positionals, childArgv };
}

/** `--env KEY=VALUE` pairs, each key a scenario key; anything else is refused before any child. */
function scenarioEnv(pairs) {
  const env = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    const key = eq > 0 ? pair.slice(0, eq) : pair;
    if (eq <= 0) throw refuse(`--env ${JSON.stringify(pair)} is not KEY=VALUE`);
    if (!SCENARIO_KEYS.includes(key)) {
      throw refuse(`--env ${key} is not a scenario key; --env takes only ${SCENARIO_KEYS.join(', ')}`);
    }
    env[key] = pair.slice(eq + 1);
  }
  return env;
}

/** The mode: `--offline` (the default), `--replay <corpus>` (an existing directory) or `--live`; one at most. */
function modeOf(opts, corpusArg) {
  const modes = [...opts.modes];
  if (corpusArg !== undefined) modes.push('replay <corpus>');
  if (modes.length > 1) throw refuse(`one mode at most, got ${modes.join(' and ')}`);
  const mode = modes.length === 0 || modes[0] === '--offline' ? 'offline' : modes[0] === '--live' ? 'live' : 'replay';
  let corpus = null;
  if (mode === 'replay') {
    corpus = resolve(corpusArg ?? opts.replay ?? '');
    if (!(corpusArg ?? opts.replay)) throw refuse('--replay needs a corpus directory');
    if (!existsSync(corpus) || !statSync(corpus).isDirectory()) throw refuse(`the replay corpus ${corpus} is not a directory`);
  }
  if (opts.synthetic && mode !== 'replay') throw refuse('--synthetic needs --replay <corpus>');
  return { mode, corpus, synthetic: mode === 'replay' && opts.synthetic === true };
}

function timeoutOf(opts, fallbackS) {
  if (opts.timeout === undefined) return fallbackS * 1000;
  const s = Number(opts.timeout);
  if (!Number.isFinite(s) || s <= 0) throw refuse(`--timeout takes a positive number of seconds, got ${JSON.stringify(opts.timeout)}`);
  return s * 1000;
}

function labelOf(value, fallback) {
  const label = value ?? fallback;
  if (!LABEL.test(label)) throw refuse(`the label ${JSON.stringify(label)} is not a file name (letters, digits, dot, dash, underscore)`);
  return label;
}

function followOf(opts) {
  if (opts.follow === undefined) return null;
  if (!/^[a-z0-9_.-]{1,64}$/.test(opts.follow)) throw refuse(`--follow takes an alias or a slug, got ${JSON.stringify(opts.follow)}`);
  return opts.follow;
}

/** The subcommand of a CLI argv: its first token that is neither an option nor a global option's value. */
function subcommandOf(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return argv[i + 1];
    if (a.startsWith('-')) {
      if (CLI_VALUE_OPTIONS.has(a)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

/** The child argv `run` may start: the install commands, star, _refresh and any --copy are refused before any child. */
function checkChildArgv(argv) {
  if (!argv || argv.length === 0) throw refuse('no CLI command: put it after --, e.g. -- today 2026-10-07');
  const sub = subcommandOf(argv);
  if (sub !== undefined && REFUSED_COMMANDS.has(sub)) {
    throw refuse(`\`${sub}\` writes outside the sandbox or is the product's own internal command (the install commands, star and _refresh are never run)`);
  }
  if (argv.some((a) => a === '--copy' || a.startsWith('--copy='))) throw refuse('--copy writes the clipboard, outside the sandbox');
}

/** Inserts tokens before a child argv's own `--`, else at its end. */
function withArgs(argv, extra) {
  const at = argv.indexOf('--');
  return at < 0 ? [...argv, ...extra] : [...argv.slice(0, at), ...extra, ...argv.slice(at)];
}

/** `--lang en` unless the scenario chose a language on the argv. */
function withLang(argv) {
  return argv.some((a) => a === '--lang' || a.startsWith('--lang=')) ? argv : withArgs(argv, ['--lang', 'en']);
}

// ───────────────────────────── environment and evidence ─────────────────────────────

/** A value on NODE_OPTIONS: double-quoted, with Node's escapes; on Windows a file URL (the loader takes no drive path). */
function nodeOptionValue(path) {
  const value = WINDOWS ? pathToFileURL(path).href : path;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The run's temporary homes: HOME, the XDG config and cache homes, TMPDIR (all absolute), under one root. */
function makeHomes(cacheDir) {
  const root = mkdtempSync(join(tmpdir(), 'claudinho-verify-env-'));
  const homes = { root, home: join(root, 'home'), config: join(root, 'config'), cache: cacheDir ?? join(root, 'cache'), tmp: join(root, 'tmp') };
  for (const d of [homes.home, homes.config, homes.cache, homes.tmp]) mkdirSync(d, { recursive: true });
  if (WINDOWS) {
    mkdirSync(join(homes.home, 'AppData', 'Roaming'), { recursive: true });
    mkdirSync(join(homes.home, 'AppData', 'Local'), { recursive: true });
  }
  return homes;
}

/** Every child's environment, built from scratch: nothing of the operator's but PATH. */
function childEnv({ mode, corpus, synthetic, homes, spawnLog, fetchLog, scenario, color = false }) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: homes.home,
    XDG_CONFIG_HOME: homes.config,
    XDG_CACHE_HOME: homes.cache,
    TMPDIR: homes.tmp,
    TZ: 'UTC',
    LANG: 'en_US.UTF-8',
    CLAUDINHO_NO_STAR: '1',
    NODE_OPTIONS: `--import ${nodeOptionValue(PRELOADS[mode])} --import ${nodeOptionValue(SPAWN_COUNT)}`,
    QA_SPAWN_LOG: spawnLog,
    VERIFY_FETCH_LOG: fetchLog,
  };
  if (!color) env.NO_COLOR = '1';
  if (WINDOWS) {
    env.USERPROFILE = homes.home;
    env.APPDATA = join(homes.home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = join(homes.home, 'AppData', 'Local');
    // Node itself needs the system root on Windows (its crypto and DNS); it names no user directory.
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  }
  if (mode === 'replay') {
    env.VERIFY_REPLAY_CORPUS = corpus;
    if (synthetic) env.PARITY_SYNTHETIC = '1';
  }
  return { ...env, ...scenario };
}

/** The evidence directory: the one asked for, or a fresh timestamped one under the controller's TMPDIR. Never removed. */
function makeOut(asked) {
  if (asked !== undefined) {
    const out = resolve(asked);
    if (existsSync(out) && !statSync(out).isDirectory()) throw refuse(`--out ${out} is not a directory`);
    mkdirSync(out, { recursive: true });
    return out;
  }
  const base = join(tmpdir(), 'claudinho-verify');
  mkdirSync(base, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (let n = 0; ; n++) {
    const out = join(base, n === 0 ? stamp : `${stamp}-${n}`);
    try {
      mkdirSync(out);
      return out;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
  }
}

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '');
}

/** A log of one JSON value per line; a line that does not parse is kept as `{ unparsed }` and fails the run. */
function readJsonLines(path) {
  return readLines(path).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { unparsed: line };
    }
  });
}

function writePhase(out, label, phase, r) {
  writeFileSync(join(out, `${label}.${phase}.txt`), r.stdout);
  writeFileSync(join(out, `${label}.${phase}.err`), r.stderr);
  writeFileSync(join(out, `${label}.${phase}.exit`), `${r.exit ?? r.signal ?? 'null'}\n`);
}

/** A phase as the result carries it, with the argv the child was given after the dist. */
function phaseOf(r, argv) {
  const p = { exit: r.exit, stdout: r.stdout, stderr: r.stderr, argv };
  if (r.signal) p.signal = r.signal;
  if (r.timedOut) p.timedOut = true;
  return p;
}

// ───────────────────────────── children ─────────────────────────────

/** The aborts of the children running now, called on an interrupt of the controller. */
const running = new Set();
let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    // The second interrupt does not wait for the evidence.
    if (interrupted) process.exit(130);
    interrupted = true;
    for (const abort of running) abort();
  });
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/** Every descendant of a pid, read once from the process table (pid and parent pid), before any signal. */
function descendantsOf(pid) {
  const r = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const children = new Map();
  for (const line of r.stdout.split('\n')) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(p) || !Number.isInteger(pp)) continue;
    if (!children.has(pp)) children.set(pp, []);
    children.get(pp).push(p);
  }
  const found = [];
  const queue = [pid];
  while (queue.length) {
    for (const c of children.get(queue.shift()) ?? []) {
      found.push(c);
      queue.push(c);
    }
  }
  return found;
}

function signal(target, sig) {
  try {
    process.kill(target, sig);
  } catch {
    // Already gone.
  }
}

/**
 * Starts one child: stdin a pipe ended at once (kept open with `keepStdin`, or a file descriptor), stdout and stderr
 * kept, a deadline after which it is sent TERM, then KILL after a grace, and reaped. With `group`, the child leads a
 * process group of its own (detached) and the deadline signals the whole group and every descendant recorded before
 * the first signal, then waits until they are gone. Returns the child and a promise of its result.
 */
function startChild(command, args, { env, cwd = ROOT, timeoutMs, stdinFd, keepStdin = false, group = false, onLine }) {
  let child;
  try {
    child = spawn(command, args, { env, cwd, stdio: [stdinFd ?? 'pipe', 'pipe', 'pipe'], detached: group });
  } catch (e) {
    const r = { exit: null, signal: null, timedOut: false, stdout: '', stderr: `could not start ${command}: ${e.message}\n` };
    return { child: null, result: Promise.resolve(r) };
  }
  const result = new Promise((done) => {
    const out = [];
    const err = [];
    let timedOut = false;
    let finished = false;
    let killTimer = null;
    let exitTimer = null;
    let lineBuf = '';
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', (d) => {
      out.push(d);
      if (!onLine) return;
      lineBuf += decoder.write(d);
      for (let i = lineBuf.indexOf('\n'); i >= 0; i = lineBuf.indexOf('\n')) {
        const line = lineBuf.slice(0, i);
        lineBuf = lineBuf.slice(i + 1);
        onLine(line);
      }
    });
    child.stderr.on('data', (d) => err.push(d));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      if (!keepStdin) child.stdin.end();
    }
    let tree = [];
    const kill = (sig) => {
      if (!child.pid) return;
      if (group) {
        signal(-child.pid, sig);
        for (const pid of tree) signal(pid, sig);
      } else signal(child.pid, sig);
    };
    const abort = () => {
      if (finished || killTimer) return;
      if (group && child.pid) tree = descendantsOf(child.pid);
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), GRACE_MS);
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    running.add(abort);
    const finish = async (code, sig, startError) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(exitTimer);
      running.delete(abort);
      if (group && child.pid) {
        // The group, and every descendant recorded before the first signal, gone before the evidence is final.
        for (let i = 0; i < 200 && (alive(-child.pid) || tree.some(alive)); i++) {
          if (i === 40) kill('SIGKILL');
          await sleep(50);
        }
      }
      if (killTimer) clearTimeout(killTimer);
      lineBuf += decoder.end();
      if (onLine && lineBuf) onLine(lineBuf);
      const r = {
        exit: code,
        signal: sig,
        timedOut,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      };
      if (startError) r.stderr += `could not start ${command}: ${startError.message}\n`;
      done(r);
    };
    child.on('error', (e) => finish(null, null, e));
    child.on('close', (code, sig) => finish(code, sig));
    // A descendant that kept stdout open would hold 'close' back forever: two seconds after the child's own exit
    // the streams are let go and the child's status stands.
    child.on('exit', (code, sig) => {
      exitTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code, sig);
      }, GRACE_MS);
    });
  });
  return { child, result };
}

function runChild(command, args, opts) {
  return startChild(command, args, opts).result;
}

// ───────────────────────────── output ─────────────────────────────

function emit(result, json, human) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.paths?.out) process.stderr.write(`verify: evidence in ${result.paths.out}\n`);
  } else {
    process.stdout.write(`${human.join('\n')}\n`);
  }
}

function fetchSummary(fetches) {
  if (fetches.length === 0) return 'fetches: none';
  const counts = {};
  for (const f of fetches) counts[f.outcome ?? 'unparsed'] = (counts[f.outcome ?? 'unparsed'] ?? 0) + 1;
  return `fetches: ${fetches.length} (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`;
}

function phaseLines(phases) {
  const lines = [];
  for (const [name, p] of Object.entries(phases)) {
    lines.push(`  ${name.padEnd(7)} exit ${p.exit ?? p.signal ?? 'null'}${p.timedOut ? ' (timed out)' : ''}`);
  }
  return lines;
}

/** Why a run is not ok, from its phases and its fetch log. */
function failuresOf(phases, fetches) {
  const failures = [];
  for (const [name, p] of Object.entries(phases)) {
    if (p.timedOut) failures.push(`${name} timed out`);
    else if (p.exit !== 0) failures.push(`${name} exit ${p.exit ?? p.signal ?? 'null'}`);
  }
  for (const f of fetches) {
    if (f.outcome === 'miss' || f.outcome === 'malformed') failures.push(`${f.outcome}: ${f.url}`);
    else if (f.unparsed !== undefined) failures.push(`an unreadable fetch log line: ${String(f.unparsed).slice(0, 120)}`);
  }
  return failures;
}

function cleanup(homes, keep) {
  if (!keep) rmSync(homes.root, { recursive: true, force: true });
}

// ───────────────────────────── doctor ─────────────────────────────

function engineFloor() {
  for (const rel of ['packages/cli/package.json', 'package.json']) {
    try {
      const range = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))?.engines?.node;
      const m = typeof range === 'string' ? /^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range) : null;
      if (m) return { range, floor: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], from: rel };
    } catch {
      // The next file.
    }
  }
  return null;
}

async function cmdDoctor(args, json) {
  const { opts, positionals, childArgv } = parseArgs('doctor', args);
  if (positionals.length || childArgv) throw refuse('doctor takes no arguments');
  const label = labelOf(opts.label, 'doctor');
  const out = makeOut(opts.out);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });

  const floor = engineFloor();
  const have = process.versions.node.split('.').map(Number);
  // The children load their preloads with --import (Node 20.6 and later), whatever the engines floor says.
  const imports = process.allowedNodeEnvironmentFlags.has('--import');
  const importNote = imports ? '' : '; this node has no --import, which every child needs';
  if (!floor) check('node', imports, `node ${process.versions.node}; no engines floor declared${importNote}`);
  else {
    const atFloor = have[0] !== floor.floor[0] ? have[0] > floor.floor[0] : have[1] !== floor.floor[1] ? have[1] > floor.floor[1] : have[2] >= floor.floor[2];
    check('node', atFloor && imports, `node ${process.versions.node}, engines ${floor.range} (${floor.from})${importNote}`);
  }
  const cliThere = existsSync(CLI);
  check('cli-dist', cliThere, cliThere ? `${CLI_REL} present` : `${CLI_REL} missing: run pnpm -r build`);
  const mcpThere = existsSync(MCP);
  check('mcp-dist', mcpThere, mcpThere ? `${MCP_REL} present` : `${MCP_REL} missing: run pnpm -r build`);

  const fetchLog = join(out, `${label}.fetches`);
  const spawnLog = join(out, `${label}.spawns`);
  writeFileSync(fetchLog, '');
  writeFileSync(spawnLog, '');
  const homes = makeHomes();
  try {
    let want = null;
    try {
      want = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8')).version;
    } catch {
      want = null;
    }
    if (!cliThere) check('version', false, `no ${CLI_REL} to ask for --version`);
    else if (typeof want !== 'string') check('version', false, 'packages/cli/package.json has no version');
    else {
      const env = childEnv({ mode: 'offline', homes, spawnLog, fetchLog, scenario: {} });
      const r = await runChild(process.execPath, [CLI, '--version'], { env, timeoutMs: DEFAULT_TIMEOUT_S * 1000 });
      const got = r.stdout.trim();
      const asked = readLines(fetchLog).length;
      let detail = r.exit === 0 ? `the dist says ${got}, packages/cli/package.json ${want}` : `--version exited ${r.exit ?? r.signal}: ${r.stderr.trim().slice(0, 200)}`;
      if (asked) detail += `; it tried the network ${asked} time(s)`;
      check('version', r.exit === 0 && got === want && asked === 0, detail);
    }
  } finally {
    rmSync(homes.root, { recursive: true, force: true });
  }

  for (const [name, write] of [['config-dir', false], ['cache-dir', true]]) {
    try {
      const dir = mkdtempSync(join(tmpdir(), `claudinho-verify-${name}-`));
      let ok = statSync(dir).isDirectory();
      if (write) {
        const f = join(dir, 'probe.json');
        writeFileSync(f, '{"probe":true}');
        ok = ok && readFileSync(f, 'utf8') === '{"probe":true}';
      }
      rmSync(dir, { recursive: true, force: true });
      ok = ok && !existsSync(dir);
      check(name, ok, `a temporary directory under ${tmpdir()} made${write ? ', written, read back' : ''} and removed`);
    } catch (e) {
      check(name, false, `a temporary directory under ${tmpdir()} could not be used: ${e.message}`);
    }
  }
  const said = (k) => `${k} is ${process.env[k] ? 'set' : 'unset'}`;
  check('env', true, `${said('CLAUDINHO_COMPETITION')}; ${said('CLAUDINHO_TEAM')} (a report: the children never see them)`);

  const fetches = readJsonLines(fetchLog);
  const ok = checks.every((c) => c.ok);
  const result = { ok, command: 'doctor', root: ROOT, checks, fetches, paths: { out } };
  writeFileSync(join(out, `${label}.result.json`), `${JSON.stringify(result, null, 2)}\n`);
  emit(result, json, [...checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(10)} ${c.detail}`), `evidence: ${out}`]);
  return ok ? 0 : 1;
}

// ───────────────────────────── run, replay, capture ─────────────────────────────

async function cmdRun(command, args, json) {
  const { opts, positionals, childArgv } = parseArgs(command, args);
  const scenario = scenarioEnv(opts.env);
  let corpusArg;
  let captureLabel;
  const rest = [...positionals];
  if (command === 'replay') {
    corpusArg = rest.shift();
    if (corpusArg === undefined) throw refuse('replay needs a corpus directory: replay <corpus> -- <argv...>');
  }
  if (command === 'capture') {
    captureLabel = rest.shift();
    if (captureLabel === undefined) throw refuse('capture needs a label: capture <label> -- <argv...>');
  }
  if (rest.length) throw refuse(`${command}: put the CLI's argv after --, got ${JSON.stringify(rest.join(' '))}`);
  const { mode, corpus, synthetic } = modeOf(opts, corpusArg);
  checkChildArgv(childArgv);
  const timeoutMs = timeoutOf(opts, DEFAULT_TIMEOUT_S);
  const label = labelOf(command === 'capture' ? captureLabel : opts.label, 'run');
  const follow = followOf(opts);
  const capture = command === 'capture';
  if (capture && !['darwin', 'linux'].includes(process.platform)) throw refuse(`capture runs on Darwin and Linux only, not on ${process.platform}`);
  if (!existsSync(CLI)) throw refuse(`${CLI_REL} is missing under ${ROOT}: run pnpm -r build`);

  const out = makeOut(opts.out);
  const spawnLog = join(out, `${label}.spawns`);
  const fetchLog = join(out, `${label}.fetches`);
  writeFileSync(spawnLog, '');
  writeFileSync(fetchLog, '');
  const homes = makeHomes();
  const env = childEnv({ mode, corpus, synthetic, homes, spawnLog, fetchLog, scenario, color: capture });
  const phases = {};
  try {
    let go = true;
    if (follow) {
      const r = await runChild(process.execPath, [CLI, 'follow', follow], { env, timeoutMs });
      writePhase(out, label, 'follow', r);
      phases.follow = phaseOf(r, ['follow', follow]);
      go = r.exit === 0 && !r.timedOut;
    }
    const argv = withLang(childArgv);
    if (go && !interrupted) {
      if (capture) phases.main = await capturePhase(out, label, argv, env, timeoutMs);
      else {
        const r = await runChild(process.execPath, [CLI, ...argv], { env, timeoutMs });
        writePhase(out, label, 'main', r);
        phases.main = phaseOf(r, argv);
      }
    }
    if (go && opts.twin && !interrupted) {
      const twin = withArgs(argv, ['--json']);
      const r = await runChild(process.execPath, [CLI, ...twin], { env, timeoutMs });
      writePhase(out, label, 'twin', r);
      phases.twin = phaseOf(r, twin);
    }
  } finally {
    cleanup(homes, opts.keep);
  }
  const spawns = readJsonLines(spawnLog);
  const fetches = readJsonLines(fetchLog);
  const failures = failuresOf(phases, fetches);
  if (interrupted) failures.push('interrupted');
  const timedOut = Object.values(phases).some((p) => p.timedOut);
  const result = {
    ok: failures.length === 0,
    command,
    mode,
    synthetic,
    ...(mode === 'replay' ? { corpus } : {}),
    label,
    argv: childArgv,
    root: ROOT,
    phases,
    timedOut,
    ...(interrupted ? { interrupted: true } : {}),
    failures,
    spawns,
    fetches,
    env: Object.keys(env).sort(),
    paths: { out, home: homes.home, config: homes.config, cache: homes.cache, tmp: homes.tmp },
  };
  writeFileSync(join(out, `${label}.result.json`), `${JSON.stringify(result, null, 2)}\n`);
  const human = [`verify ${command} (${mode}${synthetic ? ', synthetic' : ''}): ${result.ok ? 'ok' : 'FAIL'}`, ...phaseLines(phases)];
  if (phases.main?.stdout) human.push('', phases.main.stdout.replace(/\s+$/, ''), '');
  human.push(`  spawns: ${spawns.length} · ${fetchSummary(fetches)}`);
  for (const f of failures) human.push(`  failed: ${f}`);
  human.push(`  evidence: ${out}${opts.keep ? ` (kept: ${homes.root})` : ''}`);
  emit(result, json, human);
  return result.ok ? 0 : 1;
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BS = String.fromCharCode(8);
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`, 'g');
/** BSD `script` echoes the end of its stdin into the transcript as a caret D and two backspaces. */
const EOF_ECHO = new RegExp(`\\^D${BS}${BS}`, 'g');

function stripTranscript(text) {
  return text.replace(EOF_ECHO, '').replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function shellQuote(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

/**
 * The main phase under a pty: `script` detached in its own group, stdin from the null device (a socket there makes
 * Darwin's `script` fail at tcgetattr), the transcript a file flushed on every write (`-F` on Darwin, `-f` on Linux:
 * a transcript buffered for 30 seconds is lost when the deadline kills `script`). Darwin's `script` returns the
 * child's status; Linux's does with `-e`.
 */
async function capturePhase(out, label, argv, env, timeoutMs) {
  const ansi = join(out, `${label}.ansi`);
  const cmd = [process.execPath, CLI, ...argv];
  const scriptArgs = process.platform === 'darwin' ? ['-q', '-F', ansi, ...cmd] : ['-q', '-f', '-e', '-c', cmd.map(shellQuote).join(' '), ansi];
  const fd = openSync('/dev/null', 'r');
  let r;
  try {
    r = await runChild('script', scriptArgs, { env, timeoutMs, stdinFd: fd, group: true });
  } finally {
    closeSync(fd);
  }
  const transcript = existsSync(ansi) ? readFileSync(ansi, 'utf8') : '';
  if (!existsSync(ansi)) writeFileSync(ansi, '');
  const text = stripTranscript(transcript);
  writeFileSync(join(out, `${label}.txt`), text);
  writeFileSync(join(out, `${label}.main.err`), r.stderr);
  writeFileSync(join(out, `${label}.main.exit`), `${r.exit ?? r.signal ?? 'null'}\n`);
  return phaseOf({ ...r, stdout: text }, argv);
}

// ───────────────────────────── mcp ─────────────────────────────

async function cmdMcp(args, json) {
  const { opts, positionals, childArgv } = parseArgs('mcp', args);
  const scenario = scenarioEnv(opts.env);
  if (childArgv) throw refuse('mcp takes no -- argv: mcp <tool> [<json arguments>]');
  const { mode, corpus, synthetic } = modeOf(opts);
  const list = opts.list === true;
  let tool = null;
  let toolArgs = {};
  if (list) {
    if (positionals.length) throw refuse('mcp --list takes no tool');
  } else {
    if (positionals.length < 1 || positionals.length > 2) throw refuse('mcp needs a tool and at most one JSON object of arguments, or --list');
    tool = positionals[0];
    if (positionals[1] !== undefined) {
      try {
        toolArgs = JSON.parse(positionals[1]);
      } catch {
        throw refuse(`the tool's arguments are not JSON: ${positionals[1]}`);
      }
      if (toolArgs === null || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) throw refuse('the tool\'s arguments must be one JSON object');
    }
  }
  const timeoutMs = timeoutOf(opts, DEFAULT_MCP_TIMEOUT_S);
  const followTimeoutMs = timeoutOf(opts, DEFAULT_TIMEOUT_S);
  const label = labelOf(opts.label, 'mcp');
  const follow = followOf(opts);
  if (!existsSync(MCP)) throw refuse(`${MCP_REL} is missing under ${ROOT}: run pnpm -r build`);
  if (follow && !existsSync(CLI)) throw refuse(`${CLI_REL} is missing under ${ROOT}: run pnpm -r build`);

  const out = makeOut(opts.out);
  const spawnLog = join(out, `${label}.spawns`);
  const fetchLog = join(out, `${label}.fetches`);
  const rpcLog = join(out, `${label}.rpc.jsonl`);
  for (const f of [spawnLog, fetchLog, rpcLog]) writeFileSync(f, '');
  const homes = makeHomes();
  const env = childEnv({ mode, corpus, synthetic, homes, spawnLog, fetchLog, scenario });
  const phases = {};
  let session = null;
  try {
    let go = true;
    if (follow) {
      const r = await runChild(process.execPath, [CLI, 'follow', follow], { env, timeoutMs: followTimeoutMs });
      writePhase(out, label, 'follow', r);
      phases.follow = phaseOf(r, ['follow', follow]);
      go = r.exit === 0 && !r.timedOut;
    }
    if (go && !interrupted) session = await mcpSession({ env, timeoutMs, list, tool, toolArgs, rpcLog });
  } finally {
    cleanup(homes, opts.keep);
  }
  const errors = [];
  if (session) {
    writeFileSync(join(out, `${label}.txt`), session.stdout);
    writeFileSync(join(out, `${label}.err`), session.stderr);
    writeFileSync(join(out, `${label}.exit`), `${session.exit ?? session.signal ?? 'null'}\n`);
    if (session.error) errors.push(session.error);
  } else if (phases.follow) errors.push(`follow ${phases.follow.timedOut ? 'timed out' : `exit ${phases.follow.exit ?? phases.follow.signal}`}`);
  if (interrupted) errors.push('interrupted');
  const fetches = readJsonLines(fetchLog);
  const spawns = readJsonLines(spawnLog);
  const fetchFailures = failuresOf({}, fetches);
  const timedOut = Boolean(session?.timedOut) || Object.values(phases).some((p) => p.timedOut);
  const isError = session?.isError === true;
  const ok = errors.length === 0 && !isError && !timedOut && fetchFailures.length === 0;
  const result = {
    ok,
    command: 'mcp',
    mode,
    ...(mode === 'replay' ? { corpus, synthetic } : {}),
    label,
    root: ROOT,
    ...(list ? { tools: session?.tools ?? [] } : { tool, arguments: toolArgs }),
    ...(!list && session?.reply ? { content: session.reply.content, structuredContent: session.reply.structuredContent, isError } : {}),
    ...(errors.length ? { error: errors.join('; ') } : {}),
    timedOut,
    exit: session?.exit ?? null,
    ...(session?.signal ? { signal: session.signal } : {}),
    ...(Object.keys(phases).length ? { phases } : {}),
    failures: [...errors, ...(isError && !errors.length ? [`the tool answered isError: ${textOf(session.reply).slice(0, 200)}`] : []), ...fetchFailures],
    spawns,
    fetches,
    env: Object.keys(env).sort(),
    paths: { out, home: homes.home, config: homes.config, cache: homes.cache, tmp: homes.tmp },
  };
  writeFileSync(join(out, `${label}.result.json`), `${JSON.stringify(result, null, 2)}\n`);
  const human = [`verify mcp ${list ? '--list' : tool} (${mode}): ${ok ? 'ok' : 'FAIL'}`];
  if (list) for (const t of result.tools) human.push(`  ${t.name}${t.outputSchema ? '' : ' (no outputSchema)'}`);
  else if (session?.reply) human.push('', textOf(session.reply).replace(/\s+$/, '') || '(no text content)', '');
  human.push(`  server exit ${result.exit ?? result.signal ?? 'null'} · spawns: ${spawns.length} · ${fetchSummary(fetches)}`);
  for (const f of result.failures) human.push(`  failed: ${f}`);
  human.push(`  evidence: ${out}`);
  emit(result, json, human);
  return ok ? 0 : 1;
}

/** The text of a tool result's first text content. */
function textOf(result) {
  const c = Array.isArray(result?.content) ? result.content.find((x) => x?.type === 'text') : undefined;
  return typeof c?.text === 'string' ? c.text : '';
}

const rpcError = (step, e) => `${step}: JSON-RPC error ${e?.code ?? '?'}: ${e?.message ?? JSON.stringify(e)}`;

/**
 * One stdio session with the built server: initialize (protocol 2024-11-05, as the stdio smoke), initialized,
 * tools/list (every tool must declare an outputSchema), then tools/call unless listing; each request waits for its
 * reply, then stdin is closed and the server's own exit awaited, all within the deadline. The server's stdout is
 * read line by line: a line that is not a JSON-RPC 2.0 message is a stray line, which fails the session without
 * ending it.
 */
async function mcpSession({ env, timeoutMs, list, tool, toolArgs, rpcLog }) {
  const waiters = new Map();
  const stray = [];
  const log = (dir, msg) => appendFileSync(rpcLog, `${JSON.stringify({ dir, msg })}\n`);
  const onLine = (line) => {
    const text = line.replace(/\r$/, '');
    if (text.trim() === '') return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      msg = undefined;
    }
    if (msg === null || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      stray.push(text);
      log('stray', text);
      return;
    }
    log('in', msg);
    // A reply carries our id and no method; a request or a notification from the server answers nothing of ours.
    if (msg.method === undefined && msg.id !== undefined && msg.id !== null) waiters.get(msg.id)?.(msg);
  };
  const started = startChild(process.execPath, [MCP], { env, timeoutMs, keepStdin: true, onLine });
  let ended = false;
  const result = started.result.then((r) => {
    ended = true;
    for (const w of [...waiters.values()]) w(undefined);
    return r;
  });
  const send = (msg) => {
    if (ended || !started.child?.stdin?.writable) return;
    log('out', msg);
    started.child.stdin.write(`${JSON.stringify(msg)}\n`);
  };
  const ask = (id, method, params) =>
    new Promise((done) => {
      if (ended) return done(undefined);
      waiters.set(id, (m) => {
        waiters.delete(id);
        done(m);
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  const errors = [];
  let tools = null;
  let reply = null;
  const missing = (step) => (ended ? `no reply to ${step} (the server ended)` : `no reply to ${step}`);
  const init = await ask(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-claudinho', version: '1' } });
  if (!init) errors.push(missing('initialize'));
  else if (init.error) errors.push(rpcError('initialize', init.error));
  else {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await ask(2, 'tools/list', {});
    if (!listed) errors.push(missing('tools/list'));
    else if (listed.error) errors.push(rpcError('tools/list', listed.error));
    else {
      tools = (Array.isArray(listed.result?.tools) ? listed.result.tools : []).map((t) => ({ name: t?.name, outputSchema: t?.outputSchema }));
      const bare = tools.filter((t) => t.outputSchema == null).map((t) => t.name);
      if (bare.length) errors.push(`tools without an outputSchema: ${bare.join(', ')}`);
      if (!list) {
        const called = await ask(3, 'tools/call', { name: tool, arguments: toolArgs });
        if (!called) errors.push(missing('tools/call'));
        else if (called.error) errors.push(rpcError('tools/call', called.error));
        else {
          reply = called.result ?? {};
          // The SDK answers a protocol failure inside a call (an unknown tool, arguments its schema refuses) as a
          // tool result whose text is "MCP error <code>: ..."; that is a protocol error, not the tool's own.
          if (reply.isError === true && /^MCP error -?\d+:/.test(textOf(reply))) errors.push(`tools/call: ${textOf(reply)}`);
        }
      }
    }
  }
  started.child?.stdin?.end();
  const r = await result;
  if (r.timedOut) errors.unshift(`timed out after ${timeoutMs / 1000} s`);
  if (stray.length) errors.push(`${stray.length} stray line(s) on the server's stdout, the first: ${stray[0].slice(0, 200)}`);
  return { ...r, tools, reply, isError: reply?.isError === true, error: errors.length ? errors.join('; ') : null };
}

// ───────────────────────────── seed, prompt, hook ─────────────────────────────

function cacheOf(value) {
  if (value === undefined) return undefined;
  if (!isAbsolute(value)) throw refuse(`--cache takes an absolute directory, got ${JSON.stringify(value)}`);
  return resolve(value);
}

function slugOf(value) {
  if (value === undefined) throw refuse('--seed club needs --slug <slug>, e.g. --slug eng.1');
  if (value.length > 64 || !SLUG.test(value)) throw refuse(`--slug takes a provider slug such as eng.1, got ${JSON.stringify(value)}`);
  return value;
}

/** What `seed <kind>` would write: the one seed's file for a club, nothing at all for none. */
function seedPlan(kind, opts) {
  if (kind === 'club') {
    const slug = slugOf(opts.slug);
    return { kind, slug, wrote: (cache) => join(cache, 'claudinho', stateFileName('espn', slug)) };
  }
  if (kind === 'none') {
    if (opts.slug !== undefined) throw refuse('--seed none takes no --slug');
    return { kind, slug: null, wrote: () => null };
  }
  throw refuse(`the seed is club or none, got ${JSON.stringify(kind)}`);
}

/** Writes a seed: club through the one seed (`seedClub`, stamped now); none makes an EMPTY directory and nothing else. */
function applySeed(plan, cache) {
  mkdirSync(cache, { recursive: true });
  if (plan.kind === 'none') {
    if (readdirSync(cache).length) throw refuse(`--seed none needs an empty cache directory; ${cache} has entries`);
    return null;
  }
  return seedClub(cache, plan.slug);
}

async function cmdSeed(args, json) {
  const { opts, positionals, childArgv } = parseArgs('seed', args);
  if (childArgv) throw refuse('seed takes no -- argv');
  if (positionals.length !== 1) throw refuse('seed club --slug <slug> --cache <dir> | seed none --cache <dir>');
  const plan = seedPlan(positionals[0], opts);
  if (opts.cache === undefined) throw refuse('seed needs --cache <absolute dir>');
  const cache = cacheOf(opts.cache);
  const dryRun = opts['dry-run'] === true;
  const wrote = dryRun ? plan.wrote(cache) : applySeed(plan, cache);
  const result = { ok: true, command: 'seed', kind: plan.kind, slug: plan.slug, cache, dryRun, wrote };
  emit(result, json, [`verify seed ${plan.kind}${dryRun ? ' (dry run)' : ''}: ${wrote ? `${dryRun ? 'would write' : 'wrote'} ${wrote}` : `${cache}, empty`}`]);
  return 0;
}

async function cmdAmbient(command, args, json) {
  const { opts, positionals, childArgv } = parseArgs(command, args);
  const scenario = scenarioEnv(opts.env);
  if (positionals.length || childArgv) throw refuse(`${command} takes options only: ${command} [--seed club --slug <slug> | --seed none] [--follow <alias>] [--cache <dir>]`);
  const plan = opts.seed !== undefined ? seedPlan(opts.seed, opts) : null;
  if (!plan && opts.slug !== undefined) throw refuse('--slug goes with --seed club');
  const cacheDir = cacheOf(opts.cache);
  const timeoutMs = timeoutOf(opts, DEFAULT_TIMEOUT_S);
  const label = labelOf(opts.label, command);
  const follow = followOf(opts);
  if (!existsSync(CLI)) throw refuse(`${CLI_REL} is missing under ${ROOT}: run pnpm -r build`);
  if (plan?.kind === 'none' && cacheDir && existsSync(cacheDir) && readdirSync(cacheDir).length) {
    throw refuse(`--seed none needs an empty cache directory; ${cacheDir} has entries`);
  }

  const out = makeOut(opts.out);
  const spawnLog = join(out, `${label}.spawns`);
  const fetchLog = join(out, `${label}.fetches`);
  writeFileSync(spawnLog, '');
  writeFileSync(fetchLog, '');
  const homes = makeHomes(cacheDir);
  const env = childEnv({ mode: 'offline', homes, spawnLog, fetchLog, scenario });
  const phases = {};
  let seeded = null;
  try {
    // The seed first, before any child: a refused seed starts nothing.
    if (plan) seeded = applySeed(plan, homes.cache);
    let go = true;
    if (follow) {
      const r = await runChild(process.execPath, [CLI, 'follow', follow], { env, timeoutMs });
      writePhase(out, label, 'follow', r);
      phases.follow = phaseOf(r, ['follow', follow]);
      go = r.exit === 0 && !r.timedOut;
    }
    if (go && !interrupted) {
      const t0 = performance.now();
      const r = await runChild(process.execPath, [CLI, command], { env, timeoutMs });
      const ms = Math.round(performance.now() - t0);
      writePhase(out, label, 'main', r);
      phases.main = { ...phaseOf(r, [command]), ms };
    }
  } finally {
    cleanup(homes, opts.keep);
  }
  const spawns = readJsonLines(spawnLog);
  const fetches = readJsonLines(fetchLog);
  const failures = failuresOf(phases, fetches);
  if (interrupted) failures.push('interrupted');
  const result = {
    ok: failures.length === 0,
    command,
    mode: 'offline',
    label,
    root: ROOT,
    seed: plan ? plan.kind : null,
    seeded,
    phases,
    timedOut: Object.values(phases).some((p) => p.timedOut),
    ...(interrupted ? { interrupted: true } : {}),
    failures,
    spawns,
    fetches,
    env: Object.keys(env).sort(),
    paths: { out, home: homes.home, config: homes.config, cache: homes.cache, tmp: homes.tmp },
  };
  writeFileSync(join(out, `${label}.result.json`), `${JSON.stringify(result, null, 2)}\n`);
  const human = [`verify ${command}: ${result.ok ? 'ok' : 'FAIL'}`, ...phaseLines(phases)];
  if (phases.main) human.push('', phases.main.stdout.replace(/\s+$/, '') || '(nothing printed)', '', `  wall time ${phases.main.ms} ms (printed, never asserted)`);
  human.push(`  spawns: ${spawns.length} · ${fetchSummary(fetches)}`);
  for (const f of failures) human.push(`  failed: ${f}`);
  human.push(`  evidence: ${out}`);
  emit(result, json, human);
  return result.ok ? 0 : 1;
}

// ───────────────────────────── main ─────────────────────────────

async function main(argv) {
  const [command, ...args] = argv;
  const cut = args.indexOf('--');
  const json = (cut < 0 ? args : args.slice(0, cut)).includes('--json');
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    if (command === undefined) throw refuse('no command (see --help)');
    if ((cut < 0 ? args : args.slice(0, cut)).some((a) => a === '--help' || a === '-h')) {
      process.stdout.write(HELP);
      return 0;
    }
    switch (command) {
      case 'doctor':
        return await cmdDoctor(args, json);
      case 'run':
      case 'replay':
      case 'capture':
        return await cmdRun(command, args, json);
      case 'mcp':
        return await cmdMcp(args, json);
      case 'seed':
        return await cmdSeed(args, json);
      case 'prompt':
      case 'hook':
        return await cmdAmbient(command, args, json);
      default:
        throw refuse(`unknown command ${JSON.stringify(command)} (see --help)`);
    }
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, command: command ?? null, error: e.message }, null, 2)}\n`);
    process.stderr.write(`verify: ${e.message}\n`);
    if (!json) process.stderr.write('usage: node scripts/verify.mjs <command> [options] (see --help)\n');
    return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`verify: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  },
);
