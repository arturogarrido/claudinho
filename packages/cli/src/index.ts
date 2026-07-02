import { Command } from 'commander';
import { resolveConfig, type RawGlobalOpts } from './config';
import { makeT } from './i18n';
import {
  cmdHook,
  cmdInitClaude,
  cmdInitCursor,
  cmdInitCursorStatusline,
  cmdInitHook,
  cmdInitStatusline,
  cmdLive,
  cmdMarkets,
  cmdMatch,
  cmdNext,
  cmdPrompt,
  cmdRefresh,
  cmdShare,
  cmdTable,
  cmdTeam,
  cmdBracket,
  cmdStar,
  cmdToday,
  cmdVibe,
  InputError,
} from './commands';

// Exit cleanly when a downstream reader closes the pipe early (e.g.
// `claudinho table | head`). Without this, the write to a closed stdout raises
// an unhandled EPIPE 'error' event and Node dumps a raw stack trace.
function handlePipeError(stream: NodeJS.WriteStream): void {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}
handlePipeError(process.stdout);
handlePipeError(process.stderr);

// Injected from package.json at build time (tsup `define`); falls back when run
// unbuilt (e.g. tests). Single source of truth: packages/cli/package.json.
const VERSION = process.env.CLAUDINHO_VERSION ?? '0.0.0-dev';
const DISCLAIMER =
  'Claudinho is an independent fan project. Not affiliated with or endorsed by FIFA or Anthropic.';

function ctxFrom(cmd: Command) {
  // Global opts live on the root program. Walk all the way up — a nested
  // subcommand (e.g. `init cursor`) has its group command (`init`) as parent,
  // not the root, so a single `.parent` would read the wrong opts.
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  const opts = root.opts<RawGlobalOpts>();
  const cfg = resolveConfig(opts);
  return { cfg, t: makeT(cfg.lang) };
}

function fail(err: unknown): never {
  // InputError is a clean, user-facing validation message (no prefix noise).
  const prefix = err instanceof InputError ? '' : 'claudinho: ';
  process.stderr.write(`${prefix}${(err as Error).message}\n`);
  process.exit(1);
}

const program = new Command();

program
  .name('claudinho')
  .description(
    'The 2026 men’s football tournament in your terminal, your Claude Code / Cursor CLI statusline, and any MCP client.\n' +
      DISCLAIMER,
  )
  .version(VERSION, '-v, --version')
  .option('--lang <code>', 'language: en, es, pt, fr')
  .option('--tz <zone>', 'IANA timezone, e.g. America/Mexico_City')
  .option('--json', 'output JSON (for scripting)')
  .option('--no-color', 'disable ANSI colors')
  .option('--source <name>', 'live data provider (advanced)')
  .option('--flavor <level>', 'commentary flair: off, subtle, full (default: full)')
  .option('--no-markets', 'hide prediction-market signals (informational only)');

program.addHelpText('after', '\n#VibingLaVidaLoca ⚽');

program
  .command('today')
  .description("show a day's fixtures (default: today)")
  .argument('[date]', 'date as YYYY-MM-DD')
  .action(async (date, _opts, cmd) => {
    try {
      await cmdToday(date, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('live')
  .description('show matches in play right now')
  .action(async (_opts, cmd) => {
    try {
      await cmdLive(ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('next')
  .description("show a team's next fixture")
  .argument('[team]', 'team name or code, e.g. Mexico or MEX (default: $CLAUDINHO_TEAM)')
  .action(async (team, _opts, cmd) => {
    try {
      await cmdNext(team, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('team')
  .description('resolve a nation name or code to its FIFA code, flag, and group')
  .argument('<query>', 'team name or 3-letter code, e.g. Mexico, MEX, "DR Congo"')
  .action((query, _opts, cmd) => {
    try {
      cmdTeam(query, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('table')
  .description('show group standings (default: all groups)')
  .argument('[group]', 'group letter A-L')
  .action(async (group, _opts, cmd) => {
    try {
      await cmdTable(group, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('bracket')
  .description('show the knockout bracket (default: all rounds)')
  .argument('[stage]', 'filter by stage: R32, R16, QF, SF, 3P, F')
  .option('--tree', 'ASCII tree view (falls back to list when terminal is narrow)')
  .action(async (stage, opts, cmd) => {
    try {
      await cmdBracket(stage, opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('match')
  .description('show a single match by id')
  .argument('<id>', 'match id')
  .action(async (id, _opts, cmd) => {
    try {
      await cmdMatch(id, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('markets')
  .description('show prediction-market signals (read-only, informational only)')
  .argument('[target]', 'date (YYYY-MM-DD), match id, "today", or "next"')
  .argument('[team]', 'team name or code when target is "next", e.g. Mexico or MEX (default: $CLAUDINHO_TEAM)')
  .action(async (target, team, _opts, cmd) => {
    try {
      await cmdMarkets(target, team, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('share')
  .description('print a shareable, copy-pasteable match snippet (#VibingLaVidaLoca)')
  .argument('[target]', '"today" (default), "live", a date, a match id, "next", "table", or "bracket"')
  .argument(
    '[team]',
    'team name or code for "next" (default: $CLAUDINHO_TEAM), group letter for "table", or stage for "bracket"',
  )
  .option('--style <style>', 'snippet style: social (default) or compact')
  .option('--copy', 'also copy the snippet to the clipboard (best-effort)')
  .option('--no-hashtag', 'omit the #VibingLaVidaLoca tag')
  .option('--no-install-line', 'omit the install/run cue')
  .action(async (target, team, opts, cmd) => {
    try {
      await cmdShare(target, team, opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('prompt')
  .description('print a status line (Claude Code / Cursor CLI statusline, tmux, Starship, …)')
  .action((_opts, cmd) => {
    cmdPrompt(ctxFrom(cmd));
  });

// One-step setup aliases. `init cursor` / `init claude` compose the granular
// init-* commands into a single command per agent (statusline + hook + MCP).
const init = program
  .command('init')
  .description('one-step setup for your agent: `init cursor` or `init claude`');

init
  .command('cursor')
  .description('set up claudinho for the Cursor CLI (statusline + MCP config)')
  .option('--print', 'print the config snippets for manual install instead of writing them')
  .action((opts, cmd) => {
    try {
      cmdInitCursor(opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

init
  .command('claude')
  .description('set up claudinho for Claude Code (statusline + hook + MCP)')
  .option('--print', 'print the config snippets for manual install instead of writing them')
  .action((opts, cmd) => {
    try {
      cmdInitClaude(opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('init-statusline')
  .description('configure the Claude Code statusline to use claudinho')
  .option('--print', 'print the settings snippet instead of writing it')
  .option('--command <cmd>', 'command to run (default: claudinho prompt)')
  .action((opts, cmd) => {
    try {
      cmdInitStatusline(opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('init-cursor-statusline')
  .description('configure the Cursor CLI statusline to use claudinho')
  .option('--print', 'print the settings snippet instead of writing it')
  .option('--command <cmd>', 'command to run (default: claudinho prompt)')
  .action((opts, cmd) => {
    try {
      cmdInitCursorStatusline(opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('hook')
  .description('print live-score context for a Claude Code UserPromptSubmit hook (silent off-match)')
  .action((_opts, cmd) => {
    cmdHook(ctxFrom(cmd));
  });

program
  .command('init-hook')
  .description('wire the live-score hook into Claude Code (UserPromptSubmit)')
  .option('--print', 'print the settings snippet instead of writing it')
  .option('--command <cmd>', 'command to run (default: claudinho hook)')
  .action((opts, cmd) => {
    try {
      cmdInitHook(opts, ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });

program
  .command('vibe')
  .description('print a matchday-coder one-liner (#VibingLaVidaLoca)')
  .action((_opts, cmd) => {
    cmdVibe(ctxFrom(cmd));
  });

program
  .command('star')
  .description('how to support Claudinho — star the repo ⭐')
  .action((_opts, cmd) => {
    cmdStar(ctxFrom(cmd));
  });

// Internal: cold-path cache refresher, spawned detached by `prompt`.
const refreshCmd = new Command('_refresh')
  .description('(internal) refresh the statusline cache')
  .action(async (_opts, cmd) => {
    try {
      await cmdRefresh(ctxFrom(cmd));
    } catch (e) {
      fail(e);
    }
  });
program.addCommand(refreshCmd, { hidden: true });

program.parseAsync().catch(fail);
