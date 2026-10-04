import { asFlavorLevel, type CompetitionSelection, type FlavorLevel, resolveCompetition } from '@claudinho/core';

/** Resolved global options, derived from flags + env + system defaults. */
export interface CliConfig {
  lang: string;
  tz: string | undefined;
  json: boolean;
  color: boolean;
  source: string;
  /**
   * The competition this invocation is for (a provider slug, e.g. `fifa.world`,
   * `eng.1`), or `''` when the selection was refused (a refused value is never
   * a competition: every command stops before it is read). Resolved HERE,
   * once — this is the CLI's edge — and read from the config by every
   * command, the statusline, the hook and the refresher. Nothing below asks
   * the environment again.
   */
  competition: string;
  /**
   * What the edge resolved, and from where (`--competition`, the environment,
   * the default), or the value it REFUSED: what the mode line says, what
   * `--json`'s `competition` key carries, and what every interactive command
   * refuses before a request (an ambient one contains it).
   */
  selection: CompetitionSelection;
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

export function resolveConfig(opts: RawGlobalOpts): CliConfig {
  // Flag an explicit --lang we can't honor, so the command can warn (mirrors tz).
  const langRequestedUnsupported =
    opts.lang && !isSupportedLang(opts.lang) ? opts.lang : undefined;
  // The ONE place the CLI decides the competition: the flag, then the
  // environment (core reads none; the edge hands it in), then the default.
  const selection = resolveCompetition(opts.competition, process.env.CLAUDINHO_COMPETITION);
  return {
    lang: pickLang(opts.lang),
    tz: opts.tz ?? process.env.CLAUDINHO_TZ ?? undefined,
    json: opts.json ?? false,
    color: pickColor(opts.color),
    source: opts.source ?? process.env.CLAUDINHO_SOURCE ?? 'espn',
    competition: selection.kind === 'selected' ? selection.slug : '',
    selection,
    flavor: asFlavorLevel(opts.flavor ?? process.env.CLAUDINHO_FLAVOR),
    markets: pickMarkets(opts.markets),
    langRequestedUnsupported,
  };
}
