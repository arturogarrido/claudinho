/** Resolved global options, derived from flags + env + system defaults. */
export interface CliConfig {
  lang: string;
  tz: string | undefined;
  json: boolean;
  color: boolean;
  source: string;
}

export interface RawGlobalOpts {
  lang?: string;
  tz?: string;
  json?: boolean;
  color?: boolean;
  source?: string;
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

export function resolveConfig(opts: RawGlobalOpts): CliConfig {
  return {
    lang: pickLang(opts.lang),
    tz: opts.tz ?? process.env.CLAUDINHO_TZ ?? undefined,
    json: opts.json ?? false,
    color: pickColor(opts.color),
    source: opts.source ?? process.env.CLAUDINHO_SOURCE ?? 'espn',
  };
}
