import { asFlavorLevel, type FlavorLevel } from '@claudinho/core';

/** Resolved global options, derived from flags + env + system defaults. */
export interface CliConfig {
  lang: string;
  tz: string | undefined;
  json: boolean;
  color: boolean;
  source: string;
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
  return {
    lang: pickLang(opts.lang),
    tz: opts.tz ?? process.env.CLAUDINHO_TZ ?? undefined,
    json: opts.json ?? false,
    color: pickColor(opts.color),
    source: opts.source ?? process.env.CLAUDINHO_SOURCE ?? 'espn',
    flavor: asFlavorLevel(opts.flavor ?? process.env.CLAUDINHO_FLAVOR),
    markets: pickMarkets(opts.markets),
    langRequestedUnsupported,
  };
}
