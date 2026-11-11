/**
 * `claudinho --help`, grouped: Everyday, Setup and For programs, then the
 * options and the examples, at most 79 display columns. Held to the program
 * itself (`buildProgram`): every row names a command or an option the program
 * defines, with the arguments it takes, and every command and option the
 * program shows is named once, so a command added without a row is red here.
 * The three hyphenated setup commands are hidden from the list and still answer.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { displayWidth } from '@claudinho/core';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { HELP_EXAMPLES, HELP_GROUPS, HELP_OPTIONS, HELP_WIDTH } from '../src/help';
import { buildProgram } from '../src/program';

const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const HIDDEN_SETUP = ['init-statusline', 'init-cursor-statusline', 'init-hook'];

const program = buildProgram();
const visible = (cmd: Command): Command[] => cmd.commands.filter((c) => !(c as unknown as { _hidden: boolean })._hidden);
const usageOf = (cmd: Command): string => [cmd.name(), ...cmd.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))].join(' ');

/** The commands one help row names: `init claude|cursor` names two. */
function commandsOf(term: string): Command[] {
  const [name, ...rest] = term.split(' ');
  const cmd = program.commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`no command ${name}`);
  if (cmd.commands.length === 0) return [cmd];
  return rest.join(' ').split('|').map((sub) => {
    const found = cmd.commands.find((c) => c.name() === sub);
    if (!found) throw new Error(`no command ${name} ${sub}`);
    return found;
  });
}

const help = (): string => execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('the grouped help, held to the program', () => {
  it('every command row names a command the program defines, with the arguments it takes', () => {
    for (const { rows } of HELP_GROUPS) {
      for (const [term] of rows) {
        const cmds = commandsOf(term);
        for (const cmd of cmds) {
          if (cmd.parent === program) expect(term, term).toBe(usageOf(cmd));
          else expect(term.startsWith(`${cmd.parent?.name()} `), term).toBe(true);
        }
      }
    }
  });

  it('every command the program shows is named once (help itself on the -h row); the setup commands are hidden', () => {
    const named = HELP_GROUPS.flatMap(({ rows }) => rows.flatMap(([term]) => commandsOf(term).map((c) => (c.parent === program ? c.name() : `${c.parent?.name()} ${c.name()}`))));
    expect(new Set(named).size).toBe(named.length);
    const shown = visible(program).flatMap((c) => (c.commands.length ? visible(c).map((s) => `${c.name()} ${s.name()}`) : [c.name()]));
    expect([...named].sort()).toEqual(shown.sort());
    for (const name of HIDDEN_SETUP) {
      expect(program.commands.some((c) => c.name() === name), name).toBe(true);
      expect(shown, name).not.toContain(name);
    }
  });

  it('every option row is an option the program defines, and every option is a row', () => {
    const rows = HELP_OPTIONS.map(([term]) => term);
    const defined = [...program.options.map((o) => o.flags), '-h, --help'];
    expect([...rows].sort()).toEqual([...defined].sort());
  });

  it("every example's command and flags exist", () => {
    for (const [example] of HELP_EXAMPLES) {
      const [bin, name, ...rest] = example.split(' ');
      expect(bin).toBe('claudinho');
      const cmd = program.commands.find((c) => c.name() === name);
      expect(cmd, example).toBeDefined();
      for (const flag of rest.filter((w) => w.startsWith('--'))) {
        expect(cmd?.options.some((o) => o.long === flag) || program.options.some((o) => o.long === flag), flag).toBe(true);
      }
    }
  });
});

describe('the built binary prints it', () => {
  it('the groups in order, then the options, the examples and the hashtag', () => {
    const lines = help().split('\n');
    const at = (title: string) => lines.indexOf(title);
    expect(at('Everyday:')).toBeGreaterThan(0);
    expect(at('Setup:')).toBeGreaterThan(at('Everyday:'));
    expect(at('For programs:')).toBeGreaterThan(at('Setup:'));
    expect(at('Options:')).toBeGreaterThan(at('For programs:'));
    expect(at('Examples:')).toBeGreaterThan(at('Options:'));
    expect(lines).toContain('  today [date]              a day\'s matches (YYYY-MM-DD, tomorrow, sat, +3)');
    expect(lines).toContain('  claudinho today sat                              Saturday\'s matches');
    expect(lines.at(-2)).toBe('#VibingLaVidaLoca ⚽');
  });

  it(`no line is wider than ${HELP_WIDTH} columns`, () => {
    for (const line of help().split('\n')) expect(displayWidth(line), line).toBeLessThanOrEqual(HELP_WIDTH);
  });

  it('the hidden setup commands are not listed and still answer', () => {
    const text = help();
    for (const name of HIDDEN_SETUP) {
      expect(text).not.toMatch(new RegExp(`^\\s+${name}\\b`, 'm'));
      const r = spawnSync(process.execPath, [CLI, 'help', name], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      expect(r.status, name).toBe(0);
      expect(r.stdout, name).toContain(`Usage: claudinho ${name}`);
    }
  });

  it("a command's own help stays commander's, and names the day forms", () => {
    const r = spawnSync(process.execPath, [CLI, 'help', 'today'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: claudinho today [options] [date]');
    expect(r.stdout.replace(/\s+/g, ' ')).toContain('YYYY-MM-DD, today, tomorrow, yesterday, a weekday (sat) or +N');
  });
});
