import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HELP_GROUPS } from '../src/help';
import { buildProgram } from '../src/program';

/**
 * 0.15.0 removed the share cards. The command is gone, not hidden: the program
 * defines none, the help names none, and the built binary answers it as any
 * unknown command.
 */
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('`claudinho share` is not a command', () => {
  it('the program defines no share command and no --copy option', () => {
    const program = buildProgram();
    expect(program.commands.map((c) => c.name())).not.toContain('share');
    const options = [program, ...program.commands, ...program.commands.flatMap((c) => c.commands)].flatMap((c) => c.options.map((o) => o.long));
    expect(options).not.toContain('--copy');
    expect(options).not.toContain('--no-install-line');
  });

  it('the help names no share row', () => {
    const terms = HELP_GROUPS.flatMap(({ rows }) => rows.map(([term, what]) => `${term} ${what}`));
    expect(terms.length).toBeGreaterThan(5);
    for (const row of terms) expect(row).not.toMatch(/\bshare\b|clipboard/i);
  });

  it.skipIf(!existsSync(CLI))('the built binary: an unknown command, exit 1, nothing on stdout; --help does not list it', () => {
    const env = { ...process.env, NO_COLOR: '1', CLAUDINHO_NO_STAR: '1' };
    const r = spawnSync(process.execPath, [CLI, 'share', 'next', 'MEX'], { encoding: 'utf8', env });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain("unknown command 'share'");
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', env });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('today');
    expect(help.stdout).not.toMatch(/\bshare\b|--copy/i);
  });
});
