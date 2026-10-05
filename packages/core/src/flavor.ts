/**
 * Commentary "flavor": a small, localized layer of football-broadcast energy,
 * one short exclamation for the moment a match is in, printed in the flair
 * slot of a match line (CLI and MCP text; never in structured output).
 *
 * The rule for a phrase (Arturo, Oct 5, 2026): generic genre lines AND the
 * popular catchphrases, song lines and slogans fans know are in. What stays
 * out: a real person's NAME inside a phrase (nothing impersonates anyone by
 * name), any betting word, and anything false for some score of its moment
 * (a `draw` phrase is said of a level result only, a `late` one from the 80th
 * minute, a `ht` one at the break whatever the score). The banks below are
 * the approved content, pinned to the fixture
 * `test/fixtures/flavor-bank.approved.json`: a phrase is changed there, on
 * purpose, and here to match (`flavor-bank.test.ts` compares them).
 *
 * A team's rally cry is not a phrase of the bank: it takes the slot instead
 * of the moment's phrase (`rally.ts`, through {@link matchFlairs} for a list
 * and {@link matchFlair} for one line).
 */
import { rallyCryFor, type RallyPin } from './rally';
import type { TeamKind } from './supported';
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

/**
 * The moments a phrase is said of, in the banks' order: before kickoff, in
 * play with no goal yet, in play with a goal on the board, at the break, from
 * the 80th minute, a decided full time, a level one.
 */
export const FLAVOR_MOMENTS = ['scheduled', 'live', 'goal', 'ht', 'late', 'ft', 'draw'] as const;
export type Moment = (typeof FLAVOR_MOMENTS)[number];

/**
 * One language's bank: a list of phrases per moment. Indexable by any string
 * too (a moment read from elsewhere), which yields `undefined` for one that is
 * not a moment.
 */
export type FlavorBank = Readonly<Record<Moment, readonly string[]>> & Readonly<Partial<Record<string, readonly string[]>>>;

/** Which moments each level is willing to narrate. */
const LEVEL_MOMENTS: Record<FlavorLevel, ReadonlySet<Moment>> = {
  off: new Set<Moment>(),
  // The moments that matter: a goal, the result.
  subtle: new Set<Moment>(['goal', 'ft', 'draw']),
  full: new Set<Moment>(FLAVOR_MOMENTS),
};

/** Stable index from a match id, so a given match always starts from the same phrase. */
function pickIndex(id: string, size: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return size > 0 ? h % size : 0;
}

/** A match's own phrase in a bank: the one its id hashes to ('' for an empty bank). */
function pick(id: string, bank: readonly string[]): string {
  return bank.length ? (bank[pickIndex(id, bank.length)] as string) : '';
}

/**
 * Is this full time a draw: a score on the board, level, and nobody declared
 * the winner (a shootout, or a winner the provider marks on a level score, is
 * a decided result, of which "honours even" would be false).
 */
function isDraw(m: Match): boolean {
  return m.score !== undefined && m.score.home === m.score.away && m.shootout === undefined && m.winnerCode === undefined;
}

function momentOf(m: Match): Moment | undefined {
  switch (m.status) {
    case 'HT':
      return 'ht';
    case 'LIVE': {
      // From the 80th minute, at any score; a minute nobody stated is not late.
      if (m.minute !== undefined && m.minute >= 80) return 'late';
      const goals = (m.score?.home ?? 0) + (m.score?.away ?? 0);
      return goals > 0 ? 'goal' : 'live';
    }
    case 'FT':
      return isDraw(m) ? 'draw' : 'ft';
    case 'SCHEDULED':
      return 'scheduled';
    default:
      return undefined; // postponed / cancelled: stay sober
  }
}

/** What a phrase is chosen with: the level (default `full`) and the language (default `en`, any unknown one `en`). */
export interface FlavorOpts {
  level?: FlavorLevel;
  locale?: string;
}

/** The bank a match's phrase comes from: empty when the level or the moment calls for restraint. */
function bankFor(m: Match, opts: FlavorOpts): readonly string[] {
  const level = opts.level ?? DEFAULT_FLAVOR;
  const moment = momentOf(m);
  if (!moment || !LEVEL_MOMENTS[level].has(moment)) return [];
  const lang = (opts.locale ?? 'en').slice(0, 2);
  const banks = Object.hasOwn(FLAVOR_BANKS, lang) ? FLAVOR_BANKS[lang] : FLAVOR_BANKS.en;
  return banks?.[moment] ?? [];
}

/**
 * A short, localized exclamation for a match's moment, or '' when the level
 * or moment calls for restraint. Deterministic per match id: the phrase its
 * id hashes to. A match in a list may get another one ({@link flavorsFor}).
 */
export function matchFlavor(m: Match, opts: FlavorOpts = {}): string {
  return pick(m.id, bankFor(m, opts));
}

/**
 * A phrase per match of a list, in order, none twice while the bank allows:
 * each match takes its own phrase ({@link matchFlavor}) unless a previous row
 * of THIS list already took it, and then the next phrase of its bank not yet
 * taken, cyclically from its own; once every phrase of that bank is taken,
 * its own phrase again (repeats resume). A match the level or its moment
 * leaves silent gets ''. Deterministic for the same list; the first row's
 * phrase is always its own, so a list of one is `matchFlavor`.
 */
export function flavorsFor(matches: readonly Match[], opts: FlavorOpts = {}): string[] {
  const taken = new Set<string>();
  return matches.map((m) => {
    const bank = bankFor(m, opts);
    const own = pick(m.id, bank);
    if (own === '' || !taken.has(own)) {
      if (own !== '') taken.add(own);
      return own;
    }
    const start = pickIndex(m.id, bank.length);
    for (let step = 1; step < bank.length; step++) {
      const next = bank[(start + step) % bank.length] as string;
      if (!taken.has(next)) {
        taken.add(next);
        return next;
      }
    }
    return own;
  });
}

/** What a flair slot holds: the text (empty for none), and whether it is a team's rally cry (the CLI prints one green). */
export interface Flair {
  text: string;
  rally: boolean;
}

/**
 * What a flair is chosen with: the level and the language, the competition's
 * team kind (without it no side carries a cry: a kind nobody stated vouches
 * for nothing), and the pinned team, which decides when both sides carry one.
 */
export type FlairOpts = FlavorOpts & { kind?: TeamKind; pin?: RallyPin };

/**
 * The match's rally cry when its line carries one: the level is not `off`
 * (`subtle` prints cries too, on every moment), the match has a moment (a
 * postponed or cancelled line stays sober), a team kind is stated, and a side
 * carries a cry.
 */
function cryOf(m: Match, opts: FlairOpts): string | undefined {
  if ((opts.level ?? DEFAULT_FLAVOR) === 'off' || opts.kind === undefined || momentOf(m) === undefined) return undefined;
  return rallyCryFor(m, opts.kind, opts.pin);
}

/**
 * The flair slots of a list of match lines, in order: ONE rule for every list
 * (CLI `today` and `live`, MCP `get_today` and `get_live`). A row whose side
 * carries a cry ({@link cryOf}) prints the cry (`rally: true`, in every
 * language: a fan's cry is not translated) and reserves no phrase; the other
 * rows get the phrases {@link flavorsFor} gives them, as a list of their own,
 * so they stay distinct while the bank allows whatever the cries around them.
 * With no team kind the list is `flavorsFor`'s.
 */
export function matchFlairs(matches: readonly Match[], opts: FlairOpts = {}): Flair[] {
  const cries = matches.map((m) => cryOf(m, opts));
  const phrases = flavorsFor(
    matches.filter((_, i) => cries[i] === undefined),
    opts,
  );
  let next = 0;
  return cries.map((cry) => (cry !== undefined ? { text: cry, rally: true } : { text: phrases[next++] ?? '', rally: false }));
}

/**
 * What ONE match line's flair slot holds (CLI `next` and `match`, MCP
 * `get_match` and `get_next_fixture`): the list of one ({@link matchFlairs}),
 * so the match's cry, else the phrase the caller handed in, else the match's
 * own phrase; `off` is silent whatever was handed in.
 */
export function matchFlair(m: Match, opts: FlairOpts, phrase?: string): Flair {
  if ((opts.level ?? DEFAULT_FLAVOR) === 'off') return { text: '', rally: false };
  const cry = cryOf(m, opts);
  if (cry !== undefined) return { text: cry, rally: true };
  return { text: phrase ?? matchFlavor(m, opts), rally: false };
}

/**
 * The approved banks, per language and moment, in the approved order. Frozen:
 * the content is pinned to `test/fixtures/flavor-bank.approved.json`.
 */
export const FLAVOR_BANKS: Readonly<Record<string, FlavorBank>> = freezeBanks({
  en: {
    scheduled: [
      'the big one is coming!',
      'mark your calendar!',
      'football is in the air!',
      'the countdown is on!',
      'the stage is set!',
      'kickoff draws near!',
      'clear your schedule!',
      "don't miss this one!",
      'bring on the football!',
      'get the snacks ready!',
      'scarves up, voices ready!',
      'not long to wait!',
      'set the alarm!',
      'a match worth the wait!',
      'get set for kickoff!',
    ],
    live: [
      'the tension is electric!',
      'eyes glued to the pitch!',
      'anything can happen!',
      'the deadlock holds!',
      'still goalless, for now!',
      'nothing to separate them!',
      'on a knife-edge!',
      'hearts in mouths!',
      'all to play for!',
      'hold your breath!',
      'get stuck in!',
      'edge-of-the-seat stuff!',
      'nobody has blinked yet!',
      'still waiting for the breakthrough!',
      'the net is still waiting!',
      'park the bus!',
    ],
    goal: [
      'GOOOAL!',
      'what a strike!',
      'the stadium erupts!',
      'they buried it!',
      'get in!',
      'back of the net!',
      'absolute scenes!',
      'the net bulges!',
      'the roof comes off!',
      'cue the celebrations!',
      'the place is bouncing!',
      "it's in!",
      'the crowd goes wild!',
      'goals change games!',
      'what a moment!',
      'the scoreboard ticks over!',
      'take a bow, son!',
      'oh, you beauty!',
      'what a hit!',
      'hello, hello!',
      'would you believe it?',
      'oh, I say!',
      "it's unbelievable!",
    ],
    ht: [
      'half-time!',
      'all to play for after the break!',
      'time for the oranges!',
      'forty-five more to come!',
      'the teams head in!',
      'regroup and go again!',
      'the first half is in the books!',
      'tea and tactics!',
      'the second half awaits!',
      'catch your breath, we go again!',
      "it's a game of two halves!",
    ],
    late: [
      'into the final minutes!',
      'the clock is ticking!',
      'nerves jangling!',
      'hang on in there!',
      'not long left!',
      'time is running out!',
      'every second counts now!',
      'the closing stages!',
      'hold on, hold on!',
      "it's now or never!",
      "they think it's all over!",
      "it's up for grabs now!",
      'squeaky bum time!',
    ],
    ft: [
      'the final whistle blows!',
      "it's all over!",
      'into the history books!',
      'full time!',
      "that's the whistle!",
      "and that's that!",
      'game over!',
      'the dust settles!',
      'let the debate begin!',
      'the curtain comes down!',
      'the scoreboard has spoken!',
      "that's a wrap!",
      'the referee calls time!',
      'off to the tunnel!',
      'time to catch your breath!',
      "it's a funny old game!",
      'football, bloody hell!',
    ],
    draw: [
      'honours even!',
      'nothing between them!',
      'all square at the end!',
      "they couldn't be separated!",
      'level at the whistle!',
      'spoils shared!',
      'stalemate!',
      'nobody blinks, nobody wins!',
      'deadlock to the end!',
      'even stevens!',
    ],
  },
  es: {
    scheduled: [
      '¡se viene el partidazo!',
      '¡huele a fútbol!',
      '¡a cancha llena!',
      '¡partidazo en puerta!',
      '¡ya mero arranca!',
      '¡falta poquito!',
      '¡prepara la botana!',
      '¡aparta la fecha!',
      '¡que ruede el balón!',
      '¡no te lo puedes perder!',
      '¡a ponerse la camiseta!',
      '¡a calentar motores!',
      '¡preparen la garganta!',
      '¡que se venga!',
      '¡cuenta regresiva!',
      '¡hoy hay partidazo!',
      '¡el deporte más hermoso del mundo!',
      '¡el juego del hombre!',
    ],
    live: [
      '¡está que arde!',
      '¡vibra el estadio!',
      '¡no despeguen los ojos!',
      '¡sigue en ceros!',
      '¡el cero aguanta!',
      '¡a morderse las uñas!',
      '¡qué nervios!',
      '¡partido de pronóstico reservado!',
      '¡nadie parpadea!',
      '¡vamos con todo!',
      '¡el gol se hace esperar!',
      '¡todo sigue igualito!',
      '¡no pierdan detalle!',
      '¡que no decaiga!',
      '¡aguanten la respiración!',
      '¡qué atajada!',
    ],
    goal: [
      '¡GOOOOL!',
      '¡qué golazo!',
      '¡para callar bocas!',
      '¡se cae el estadio!',
      '¡ya hay gol!',
      '¡al fondo de la red!',
      '¡se armó la fiesta!',
      '¡y adentro!',
      '¡explota la tribuna!',
      '¡se infla la red!',
      '¡a gritarlo con todo!',
      '¡se mueve el marcador!',
      '¡ruge la afición!',
      '¡eso se celebra!',
      '¡a celebrar a todo pulmón!',
      '¡hay gol en el marcador!',
      '¡golazo, azo, azo!',
      '¡ah, no bueno!',
      '¡no puede ser!',
      '¡notable, sobresaliente!',
      '¡el gol lo platicamos todos!',
      '¡que viva el fútbol!',
      '¡señoras y señores, golazo!',
      '¡la manda a guardar!',
      '¡se va, se va, se va!',
      '¡apago la luz y me voy!',
    ],
    ht: [
      '¡medio tiempo!',
      '¡se van al descanso!',
      '¡faltan 45 más!',
      '¡a tomar aire!',
      '¡todo por jugarse en el complemento!',
      '¡hora de las naranjas!',
      '¡a refrescar las piernas!',
      '¡se viene el complemento!',
      '¡la primera parte ya fue!',
      '¡a regañar en el vestidor!',
    ],
    late: [
      '¡se acaba el tiempo!',
      '¡minutos finales!',
      '¡esto se pone de pelos!',
      '¡ya casi, ya casi!',
      '¡la recta final!',
      '¡cada segundo cuenta!',
      '¡los últimos minutos!',
      '¡al filo del final!',
      '¡con el corazón en la mano!',
      '¡es ahora o nunca!',
      '¡uff, uff y recontra uff!',
    ],
    ft: [
      '¡suena el silbatazo final!',
      '¡se acabó, señores!',
      '¡a los libros de historia!',
      '¡se acabó lo que se daba!',
      '¡fin del partido!',
      '¡y colorín colorado!',
      '¡baja el telón!',
      '¡a otra cosa, mariposa!',
      '¡punto final!',
      '¡ya no hay más!',
      '¡a discutirlo en la sobremesa!',
      '¡el árbitro dice basta!',
      '¡ahí queda todo!',
      '¡así termina!',
      '¡hasta aquí llegó el partido!',
      '¡silbatazo final!',
      '¡abrazo de gol!',
      '¡su lechita y a dormir!',
    ],
    draw: [
      '¡tablas!',
      '¡empate y a casa!',
      '¡honores compartidos!',
      '¡nadie se lleva la gloria!',
      '¡igualados hasta el final!',
      '¡se quedaron a mano!',
      '¡ni para ti ni para mí!',
      '¡a nadie le alcanzó!',
      '¡empate, y punto!',
      '¡nadie cedió!',
    ],
  },
  pt: {
    scheduled: [
      'vem jogão por aí!',
      'cheira a futebol!',
      'estádio lotado!',
      'já já começa!',
      'falta pouco!',
      'prepara a pipoca!',
      'bota a camisa!',
      'jogo imperdível!',
      'marca na agenda!',
      'a bola vai rolar!',
      'liga a tv!',
      'aquece a garganta!',
      'reserva o sofá!',
      'contagem regressiva!',
      'o palco está pronto!',
      'hoje tem jogo!',
      'bem, amigos!',
    ],
    live: [
      'está pegando fogo!',
      'o estádio ferve!',
      'não tire os olhos!',
      'segue o zero!',
      'tudo igual por enquanto!',
      'roendo as unhas!',
      'coração na boca!',
      'ninguém pisca!',
      'só falta o gol!',
      'a tensão tá no ar!',
      'tá tudo em aberto!',
      'vai pra cima!',
      'segura a emoção!',
      'a bola não entra!',
      'respira fundo!',
      'rola a bola!',
      'olho no lance!',
      'fecha o ângulo!',
      'ripa na chulipa!',
      'pimba na gorduchinha!',
    ],
    goal: [
      'GOOOL!',
      'que golaço!',
      'pra calar a boca!',
      'o estádio explode!',
      'é gol!',
      'bola na rede!',
      'tá dentro!',
      'a rede balançou!',
      'saiu o gol!',
      'mexeu no placar!',
      'festa na arquibancada!',
      'comemora, galera!',
      'solta esse grito!',
      'a torcida vai à loucura!',
      'agora é outro jogo!',
      'grita, torcida!',
      'que beleza!',
      'sabe de quem?',
      'lá dentro!',
      'é rede!',
      'meu Deus do céu!',
      'olha o que ele fez!',
    ],
    ht: [
      'intervalo!',
      'fim do primeiro tempo!',
      'tudo em aberto pro segundo tempo!',
      'hora da preleção!',
      'vai pro vestiário!',
      '45 minutos pela frente!',
      'respira que tem mais!',
      'a segunda etapa vem aí!',
      'pausa pra tomar fôlego!',
      'o jogo está só na metade!',
    ],
    late: [
      'reta final!',
      'o tempo tá acabando!',
      'minutos finais!',
      'cada segundo vale ouro!',
      'segura, coração!',
      'é agora ou nunca!',
      'o relógio não para!',
      'últimos lances!',
      'aperta que tá acabando!',
      'vai até o apito!',
      'haja coração!',
      'é teste pra cardíaco!',
      'o tempo passa!',
      'crepúsculo do jogo!',
    ],
    ft: [
      'apita o juiz, acabou!',
      'fim de jogo, senhores!',
      'pros livros de história!',
      'fim de papo!',
      'acabou o tempo!',
      'placar fechado!',
      'agora é resenha!',
      'já era!',
      'tá decidido!',
      'fim da linha!',
      'hora do debate!',
      'todo mundo pro vestiário!',
      'a poeira baixou!',
      'e o jogo acabou assim!',
      'nada mais a jogar!',
      'fim de jogo!',
      'fecham-se as cortinas!',
    ],
    draw: [
      'ficou no empate!',
      'ninguém saiu na frente!',
      'tudo igual no final!',
      'empate e ponto final!',
      'honras divididas!',
      'ninguém venceu hoje!',
      'igualdade no placar!',
      'empatou e acabou!',
      'placar igual, fim de papo!',
      'sem vencedor!',
    ],
  },
  fr: {
    scheduled: [
      'ça promet, le grand match arrive !',
      'ça sent le football !',
      'stade plein !',
      'le compte à rebours est lancé !',
      'bloquez la date !',
      "vivement le coup d'envoi !",
      'ça va chauffer !',
      'le décor est planté !',
      'préparez les écharpes !',
      'maillot sur le dos !',
      'échauffez vos voix !',
      'le ballon va rouler !',
      'rendez-vous immanquable !',
      'plus très longtemps !',
      "les tribunes s'impatientent !",
    ],
    live: [
      "c'est bouillant !",
      'le stade vibre !',
      'ne quittez pas des yeux !',
      'toujours zéro partout !',
      'le suspense est total !',
      'on retient son souffle !',
      "rien n'est joué !",
      'allez, allez !',
      'on ne lâche rien !',
      'les nerfs sont à vif !',
      'on se ronge les ongles !',
      'personne ne craque !',
      'le but se fait attendre !',
      'match sous haute tension !',
      'les filets attendent !',
      'allez mon petit bonhomme !',
      'au bout !',
      "et s'il allait marquer ?",
      'quelle occasion !',
      'vas-y mon petit !',
    ],
    goal: [
      'BUUUT !',
      'quelle frappe !',
      'le stade explose !',
      'imparable !',
      'quel but !',
      'au fond des filets !',
      'et ça rentre !',
      'oh là là !',
      "c'est la folie !",
      'il y a but !',
      'les tribunes exultent !',
      'place à la fête !',
      'explosion de joie !',
      'les filets ont tremblé !',
      'de quoi lever les bras !',
      "le match s'emballe !",
      "et c'est le but !",
      'oh le but !',
      'quel pied !',
      "c'est pas possible !",
      'vous le croyez ça ?',
      "oh, c'est pas vrai !",
      "ah, c'est superbe !",
    ],
    ht: [
      'mi-temps !',
      "la pause s'impose !",
      'tout reste à jouer !',
      'retour aux vestiaires !',
      'encore 45 minutes !',
      'on souffle un peu !',
      'place à la causerie !',
      'première période terminée !',
      'la seconde période arrive !',
      'on reprend bientôt !',
      "c'est la pause !",
    ],
    late: [
      'dernières minutes !',
      'le chrono tourne !',
      'tenez bon !',
      'chaque seconde compte !',
      'la fin approche !',
      'tout se joue maintenant !',
      "dernier quart d'heure !",
      'le temps presse !',
      "jusqu'au bout !",
      "c'est le money time !",
    ],
    ft: [
      'coup de sifflet final !',
      "c'est terminé !",
      "dans les livres d'histoire !",
      'et rideau !',
      'fin du match !',
      'clap de fin !',
      'la messe est dite !',
      'tout est dit !',
      'place au débat !',
      'tout le monde aux vestiaires !',
      'la page se tourne !',
      'le temps est écoulé !',
      'place au débrief !',
      "on s'arrête là !",
      'le score est définitif !',
      'quel match !',
    ],
    draw: [
      'match nul !',
      'ils se quittent dos à dos !',
      'égalité au coup de sifflet !',
      "personne ne l'emporte !",
      'score de parité !',
      'ni vainqueur ni vaincu !',
      'on se sépare à égalité !',
      'égalité parfaite !',
      "match nul et c'est tout !",
      'chacun repart avec sa part !',
    ],
  },
});

function freezeBanks(banks: Record<string, Record<Moment, string[]>>): Readonly<Record<string, FlavorBank>> {
  for (const bank of Object.values(banks)) {
    for (const moment of FLAVOR_MOMENTS) Object.freeze(bank[moment]);
    Object.freeze(bank);
  }
  return Object.freeze(banks);
}
