import { homedir } from 'node:os';
import {
  asFlavorLevel,
  type CompetitionSelection,
  configPath,
  type FlavorLevel,
  type Pin,
  readUserConfig,
  resolveCompetition,
  type UserConfigRead,
} from '@claudinho/core';

/** Resolved global options, derived from flags + env + system defaults. */
export interface CliConfig {
  lang: string;
  tz: string | undefined;
  json: boolean;
  color: boolean;
  source: string;
  /**
   * The competition this invocation is for (a provider slug, e.g. `fifa.world`,
   * `eng.1`), or `''` when the selection was refused or nothing is chosen (no
   * competition: every command stops before it is read). Resolved HERE,
   * once — this is the CLI's edge — and read from the config by every
   * command, the statusline, the hook and the refresher. Nothing below asks
   * the environment, or the config file, again.
   */
  competition: string;
  /**
   * What the edge resolved, and from where (`--competition`, the environment,
   * the saved choice), the value it REFUSED, or `none` (nothing chosen): what
   * the mode line says, what `--json`'s `competition` key carries, and what
   * every interactive command refuses before a request (an ambient one
   * contains it).
   */
  selection: CompetitionSelection;
  /**
   * The team the user pinned with `claudinho follow <alias> --team <name>`,
   * set ONLY when the saved choice is what selected the competition (a flag or
   * an environment override leaves the pin another competition's, so it does
   * not apply). Absent on a config built by hand.
   */
  pin?: Pin;
  /**
   * The config file as this invocation read it (once, here): where it is and
   * what the read found, for `follow` to report. Absent on a config built by
   * hand.
   */
  userConfig?: { readonly path: string; readonly read: UserConfigRead };
  /** Commentary flair intensity (default: full). */
  flavor: FlavorLevel;
  /**
   * Prediction-market signals in default views (today/match). On unless
   * `--no-markets` or CLAUDINHO_MARKETS=off. Optional so test fixtures may omit
   * it (undefined is treated as on); resolveConfig always sets a boolean.
   */
  markets?: boolean;
  /** The user explicitly requested a `--lang` we don't support (for warnings). */
  langRequestedUnsupported?: string;
}

export interface RawGlobalOpts {
  lang?: string;
  tz?: string;
  json?: boolean;
  color?: boolean;
  source?: string;
  /** `--competition <alias|slug>`: an explicit competition (wins over `CLAUDINHO_COMPETITION`). */
  competition?: string;
  flavor?: string;
  /** false when --no-markets is passed (commander negatable option). */
  markets?: boolean;
}

const SUPPORTED_LANGS = ['en', 'es', 'pt', 'fr'] as const;

function pickLang(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.CLAUDINHO_LANG,
    process.env.LANG?.split('.')[0]?.split('_')[0],
  ];
  for (const c of candidates) {
    if (c && SUPPORTED_LANGS.includes(c as (typeof SUPPORTED_LANGS)[number])) {
      return c;
    }
  }
  return 'en';
}

/** Honor NO_COLOR and non-TTY output by default. */
function pickColor(explicit?: boolean): boolean {
  if (explicit === false) return false;
  if (process.env.NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

function isSupportedLang(s: string): boolean {
  return SUPPORTED_LANGS.includes(s as (typeof SUPPORTED_LANGS)[number]);
}

/** Prediction-market signals default on; off via --no-markets or CLAUDINHO_MARKETS=off. */
function pickMarkets(explicit?: boolean): boolean {
  if (explicit === false) return false; // --no-markets
  if ((process.env.CLAUDINHO_MARKETS ?? '').toLowerCase() === 'off') return false;
  return true;
}

/**
 * The user's config file, read ONCE per invocation, here at the edge: its path
 * (core `configPath`, from this process's environment and home) and core's
 * one no-follow bounded read of it (`readUserConfig`). Never throws, never
 * waits; the file is never written here (only `follow` writes it).
 */
export function readSavedChoice(): { path: string; read: UserConfigRead } {
  const path = configPath(process.env, process.platform, homedir());
  return { path, read: readUserConfig(path) };
}

/**
 * THE CLI'S EDGE for the competition: the flag, then the environment (core
 * reads none; the edge hands it in), then the saved choice (the config file's
 * `competition`, as read by {@link readSavedChoice}); nothing chosen is
 * `none`. A saved value the reader refused is no saved choice: the next source
 * down is nothing (never a guess). `follow` asks it too, with its target as the
 * flag and no saved choice, so a value it saves resolves exactly as the flag
 * would have.
 */
export function edgeSelection(opts: { competition?: string }, saved: UserConfigRead): CompetitionSelection {
  const config = saved.kind === 'read' ? saved.config : undefined;
  return resolveCompetition(opts.competition, process.env.CLAUDINHO_COMPETITION, config?.competition);
}

export function resolveConfig(opts: RawGlobalOpts, saved = readSavedChoice()): CliConfig {
  // Flag an explicit --lang we can't honor, so the command can warn (mirrors tz).
  const langRequestedUnsupported =
    opts.lang && !isSupportedLang(opts.lang) ? opts.lang : undefined;
  // The ONE place the CLI decides the competition (see `edgeSelection`).
  const selection = edgeSelection(opts, saved.read);
  // The pin is the saved choice's: it applies only when the saved choice is
  // what selected the competition (an override is another competition).
  const team = saved.read.kind === 'read' ? saved.read.config.team : undefined;
  const pin = selection.kind === 'selected' && selection.chosenBy === 'saved' && team ? { pin: team } : {};
  return {
    lang: pickLang(opts.lang),
    tz: opts.tz ?? process.env.CLAUDINHO_TZ ?? undefined,
    json: opts.json ?? false,
    color: pickColor(opts.color),
    source: opts.source ?? process.env.CLAUDINHO_SOURCE ?? 'espn',
    competition: selection.kind === 'selected' ? selection.slug : '',
    selection,
    ...pin,
    userConfig: saved,
    flavor: asFlavorLevel(opts.flavor ?? process.env.CLAUDINHO_FLAVOR),
    markets: pickMarkets(opts.markets),
    langRequestedUnsupported,
  };
}
