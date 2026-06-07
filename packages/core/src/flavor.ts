/**
 * Commentary "flavor" — a small, localized layer of football-broadcast energy
 * that lets surfaces (and the model) narrate scores with some spice.
 *
 * IMPORTANT (legal): these are GENERIC, unattributed exclamations that evoke the
 * *genre* of football commentary (with a Latin-American TV spirit for `es`).
 * They must NEVER quote, name, or impersonate a real commentator or reproduce a
 * person's signature catchphrase. Keep it that way when extending the banks.
 */
import type { Match } from './types';

/** Commentary-flair intensity. */
export type FlavorLevel = 'off' | 'subtle' | 'full';

export const FLAVOR_LEVELS = ['off', 'subtle', 'full'] as const;

/** Spice is on by default — the project ships `full`. */
export const DEFAULT_FLAVOR: FlavorLevel = 'full';

export function isFlavorLevel(s: string): s is FlavorLevel {
  return (FLAVOR_LEVELS as readonly string[]).includes(s);
}

/** Coerce arbitrary input (flag/env) to a level, defaulting to `full`. */
export function asFlavorLevel(s: string | undefined | null): FlavorLevel {
  return s && isFlavorLevel(s) ? s : DEFAULT_FLAVOR;
}

type Moment = 'scheduled' | 'live' | 'goal' | 'ft';

/** Generic, unattributed commentary energy by locale & moment. No real names. */
const BANKS: Record<string, Record<Moment, readonly string[]>> = {
  en: {
    scheduled: ['the big one is coming!', 'mark your calendar!', 'football is in the air!'],
    live: ['the tension is electric!', 'eyes glued to the pitch!', 'anything can happen!'],
    goal: ['GOOOAL!', 'what a strike!', 'the stadium erupts!', 'they buried it!'],
    ft: ['the final whistle blows!', "it's all over!", 'into the history books!'],
  },
  es: {
    scheduled: ['¡se viene el partidazo!', '¡huele a fútbol!', '¡a cancha llena!'],
    live: ['¡está que arde!', '¡vibra el estadio!', '¡no despeguen los ojos!'],
    goal: ['¡GOOOOL!', '¡qué golazo!', '¡para callar bocas!', '¡se cae el estadio!'],
    ft: ['¡suena el silbatazo final!', '¡se acabó, señores!', '¡a los libros de historia!'],
  },
  pt: {
    scheduled: ['vem jogão por aí!', 'cheira a futebol!', 'estádio lotado!'],
    live: ['está pegando fogo!', 'o estádio ferve!', 'não tire os olhos!'],
    goal: ['GOOOL!', 'que golaço!', 'pra calar a boca!', 'o estádio explode!'],
    ft: ['apita o juiz, acabou!', 'fim de jogo, senhores!', 'pros livros de história!'],
  },
  fr: {
    scheduled: ['ça promet, le grand match arrive !', 'ça sent le football !', 'stade plein !'],
    live: ["c'est bouillant !", 'le stade vibre !', 'ne quittez pas des yeux !'],
    goal: ['BUUUT !', 'quelle frappe !', 'le stade explose !', 'imparable !'],
    ft: ["coup de sifflet final !", "c'est terminé !", "dans les livres d'histoire !"],
  },
};

/** Which moments each level is willing to narrate. */
const LEVEL_MOMENTS: Record<FlavorLevel, ReadonlySet<Moment>> = {
  off: new Set<Moment>(),
  subtle: new Set<Moment>(['goal', 'ft']),
  full: new Set<Moment>(['scheduled', 'live', 'goal', 'ft']),
};

/** Stable index from a match id, so a given match always picks the same phrase. */
function pick(id: string, bank: readonly string[]): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return bank.length ? (bank[h % bank.length] as string) : '';
}

function momentOf(m: Match): Moment | undefined {
  switch (m.status) {
    case 'LIVE':
    case 'HT': {
      const goals = (m.score?.home ?? 0) + (m.score?.away ?? 0);
      return goals > 0 ? 'goal' : 'live';
    }
    case 'FT':
      return 'ft';
    case 'SCHEDULED':
      return 'scheduled';
    default:
      return undefined; // postponed / cancelled: stay sober
  }
}

/**
 * A short, localized exclamation for a match's moment — or '' when the level or
 * moment calls for restraint. Deterministic per match id. Never quotes a person.
 */
export function matchFlavor(
  m: Match,
  opts: { level?: FlavorLevel; locale?: string } = {},
): string {
  const level = opts.level ?? DEFAULT_FLAVOR;
  if (level === 'off') return '';
  const moment = momentOf(m);
  if (!moment || !LEVEL_MOMENTS[level].has(moment)) return '';
  const lang = (opts.locale ?? 'en').slice(0, 2);
  const langBank = BANKS[lang] ?? BANKS.en;
  return langBank ? pick(m.id, langBank[moment]) : '';
}
