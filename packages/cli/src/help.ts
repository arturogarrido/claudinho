import { displayWidth } from '@claudinho/core';

/**
 * `claudinho --help`, grouped by what a person came to do (commander 12 has no
 * help groups, so the root command's help is written here; a command's own
 * help, `claudinho help today`, stays commander's). Every row names a command or
 * an option the program defines, and every command and option the program
 * lists is named once: `packages/cli/test/help.test.ts` holds both against the
 * built binary, so a command added without a row fails there. English, as the
 * rest of `--help` is. At most {@link HELP_WIDTH} display columns per line.
 */

/** The widest line the help prints. */
export const HELP_WIDTH = 79;

/** Where a row's description starts: two spaces, the term, at least two spaces. */
const DESC_COLUMN = 28;

/** One row: the term as typed (a command and its arguments, or an option's flags), and what it does. */
export type HelpRow = readonly [term: string, description: string];

/** The command groups, in the order they print. */
export const HELP_GROUPS: ReadonlyArray<{ readonly title: string; readonly rows: readonly HelpRow[] }> = [
  {
    title: 'Everyday',
    rows: [
      ['today [date]', "a day's matches (YYYY-MM-DD, tomorrow, sat, +3)"],
      ['live', 'matches in play right now'],
      ['next [team]', "a team's next match (default: your pinned team)"],
      ['table [key]', 'standings (default: every table)'],
      ['match <id>', 'one match, with its goals and cards'],
      ['share [target] [team]', 'a card to paste: today, live, next, table...'],
      ['team <query>', "a nation's code, flag and group (World Cup)"],
      ['bracket [stage]', 'the knockout bracket (World Cup)'],
      ['markets [target] [team]', 'market signals, informational only (World Cup)'],
    ],
  },
  {
    title: 'Setup',
    rows: [
      ['follow [competition]', 'choose what to follow; --team pins a team, --list shows all, `follow off` forgets'],
      ['init claude|cursor', 'one-step setup for Claude Code or Cursor CLI'],
      ['init plugin', 'make room for the Claude Code plugin'],
      ['star', 'how to support Claudinho'],
    ],
  },
  {
    title: 'For programs',
    rows: [
      ['prompt', 'a status line (Claude Code, Cursor CLI, tmux)'],
      ['hook', 'live-score context for a Claude Code prompt hook'],
      ['ambient', 'the status line and hook as JSON (the plugin)'],
      ['vibe', 'a matchday one-liner for your shell'],
    ],
  },
];

/** The global options, in the order they print. */
export const HELP_OPTIONS: readonly HelpRow[] = [
  ['-c, --competition <alias|slug>', 'the competition for this command only'],
  ['--lang <code>', 'en, es, pt or fr'],
  ['--tz <zone>', 'IANA timezone, e.g. America/Mexico_City'],
  ['--json', 'JSON output, for scripts'],
  ['--flavor <level>', 'commentary: off, subtle or full (default: full)'],
  ['--no-markets', 'hide prediction-market signals'],
  ['--no-color', 'no ANSI colors'],
  ['--source <name>', 'data provider (espn, the only one today)'],
  ['-v, --version', 'the version'],
  ['-h, --help', 'this help; claudinho help <command> for one'],
];

/** The examples, each a command a person can run as it is, and what it does. */
export const HELP_EXAMPLES: readonly HelpRow[] = [
  ['claudinho follow premier-league --team Arsenal', 'follow a league, pin a team'],
  ['claudinho next', "your team's next match"],
  ['claudinho today sat', "Saturday's matches"],
];

/** Words of `text` in lines of at most `width` display columns. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && displayWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** One row: the term in its column, the description wrapped beside it (on the next line when the term is wider). */
function rowLines([term, description]: HelpRow, column = DESC_COLUMN): string[] {
  const indent = ' '.repeat(column);
  const desc = wrap(description, HELP_WIDTH - column);
  const head = `  ${term}`;
  if (displayWidth(head) + 2 > column) return [head, ...desc.map((d) => indent + d)];
  return desc.map((d, i) => (i === 0 ? head + ' '.repeat(column - displayWidth(head)) + d : indent + d));
}

/**
 * The root command's help: the usage line, the description (`about`: the
 * tagline and the disclaimer, each wrapped), the three command groups, the
 * options and the examples. Ends with a newline; the program's `after` text
 * (the hashtag) follows it.
 */
export function rootHelp(usage: string, about: readonly string[]): string {
  const out: string[] = [`Usage: ${usage}`, ''];
  for (const paragraph of about) out.push(...wrap(paragraph, HELP_WIDTH));
  for (const group of HELP_GROUPS) {
    out.push('', `${group.title}:`);
    for (const row of group.rows) out.push(...rowLines(row));
  }
  out.push('', 'Options:');
  for (const row of HELP_OPTIONS) out.push(...rowLines(row));
  out.push('', 'Examples:');
  const exampleColumn = 2 + Math.max(...HELP_EXAMPLES.map(([term]) => displayWidth(term))) + 3;
  for (const row of HELP_EXAMPLES) out.push(...rowLines(row, exampleColumn));
  return `${out.join('\n')}\n`;
}
