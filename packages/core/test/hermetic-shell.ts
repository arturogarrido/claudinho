/**
 * A sandbox for running a repository shell script offline: a PATH that holds
 * stub tools (each one records every call it receives) and links to a NAMED
 * set of host tools, and nothing else of the host's. Shared by the tests of
 * `scripts/gate.sh` and `scripts/push-and-watch.sh`; the shape is
 * `publish-workflow.test.ts`'s (0.11 · 2.7c), lifted so two files share it.
 *
 * The tests pin the CALLS a script makes ("no `git push` ran") by reading the
 * record a stub wrote, never by inferring it from the script's output.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the host keeps a tool, so the sandbox PATH can hold that tool and nothing else. */
export function hostTool(name: string): string {
  return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
}

/** A stub's body: a bash script; `$CALLS` is the record file, `$STATE` a directory the test may seed. */
export type Stubs = Record<string, string>;

export type Sandbox = {
  dir: string;
  bin: string;
  state: string;
  env: Record<string, string>;
  /** Every call the stubs received, in order: `<tool> <args...>`, one per line. */
  calls: () => string[];
};

/** The host tools every script here may use; a script that needs another names it in its own test. */
export const COMMON_HOST_TOOLS = ['date', 'sleep', 'head', 'tail', 'cat', 'mktemp', 'tr', 'awk', 'sed', 'grep', 'wc', 'basename', 'dirname', 'mkdir', 'rm', 'printf', 'env', 'uname', 'cut', 'sort', 'tee'] as const;

/** Each stub appends `<name> <args>` to `$CALLS`, then runs its body. */
export function makeSandbox(stubs: Stubs, hostTools: readonly string[] = COMMON_HOST_TOOLS, label = 'sandbox-'): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), label));
  const bin = join(dir, 'bin');
  const tools = join(dir, 'tools');
  const state = join(dir, 'state');
  const calls = join(dir, 'calls.log');
  mkdirSync(bin);
  mkdirSync(tools);
  mkdirSync(state);
  writeFileSync(calls, '');
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> "$CALLS"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  for (const name of hostTools) {
    if (!existsSync(join(bin, name))) symlinkSync(hostTool(name), join(tools, name));
  }
  // bash itself: by its host path on the PATH too, for `bash -n` inside a script.
  symlinkSync(hostTool('bash'), join(tools, 'bash'));
  const env = { PATH: `${bin}:${tools}`, HOME: dir, TMPDIR: dir, CALLS: calls, STATE: state, LC_ALL: 'C' };
  return {
    dir,
    bin,
    state,
    env,
    calls: () => readFileSync(calls, 'utf8').split('\n').filter(Boolean),
  };
}

/** Runs `bash <script> <args>` in the sandbox; `extraEnv` is added to the sandbox's. */
export function runScript(
  script: string,
  args: string[],
  sandbox: Sandbox,
  extraEnv: Record<string, string> = {},
  opts: { cwd?: string; timeout?: number } = {},
): { status: number | null; out: string; stdout: string; stderr: string } {
  const r = spawnSync(hostTool('bash'), [script, ...args], {
    env: { ...sandbox.env, ...extraEnv },
    cwd: opts.cwd ?? sandbox.dir,
    encoding: 'utf8',
    timeout: opts.timeout ?? 20000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout, stderr: r.stderr };
}

/** `bash -n` on a script: the whole file parses before any state is run. */
export function parses(script: string): number | null {
  return spawnSync(hostTool('bash'), ['-n', script], { encoding: 'utf8' }).status;
}

/**
 * Starts `bash <script> <args>` in the sandbox WITHOUT waiting: for a test that signals the script while it runs
 * (a TERM to its pid alone) and then reads what it left behind. `done` resolves when the process closes.
 */
export function startScript(
  script: string,
  args: string[],
  sandbox: Sandbox,
  extraEnv: Record<string, string> = {},
  opts: { cwd?: string } = {},
): { child: ChildProcess; done: Promise<{ status: number | null; signal: NodeJS.Signals | null; out: string }> } {
  const child = spawn(hostTool('bash'), [script, ...args], {
    env: { ...sandbox.env, ...extraEnv },
    cwd: opts.cwd ?? sandbox.dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
  const done = new Promise<{ status: number | null; signal: NodeJS.Signals | null; out: string }>((resolve) => {
    child.on('close', (status, signal) => resolve({ status, signal, out }));
  });
  return { child, done };
}

/** Whether a process id is alive (signal 0). */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Polls `cond` every 50 ms until it holds or `ms` have passed; returns whether it held. */
export async function until(cond: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}
