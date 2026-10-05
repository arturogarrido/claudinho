/**
 * The team rally cries: a team's own cry takes the flair slot of its match
 * line instead of the moment's phrase, in every language (a fan's cry is not
 * translated). Mexico's "¿Y si sí?" was the first, and was hard-coded; it is
 * now one row of the table.
 *
 * A side carries a cry by IDENTITY, in a competition whose teams are of the
 * entry's kind (a nation's cry in a nations competition, a club's in a club
 * one): by the provider's id when the side carries one (the same id for a club
 * in every competition; a present id that is not the entry's is never that
 * team, whatever its labels say), or, for an id-less side in a nations
 * competition (the bundle's nations), by its code AND its name. A club's side
 * with no id carries none: a club's code is a label, not an identity. When
 * both sides carry one, the pinned side's cry when the pin is one of them,
 * else the home side's.
 *
 * The content is pinned to the approved fixture
 * `test/fixtures/rally-cries.approved.json`: a cry is changed there, on
 * purpose, and here to match (`flavor-bank.test.ts` compares them).
 */
import type { TeamKind } from './supported';
import type { Match, Team } from './types';

/** One team's cry: the provider's id (the key), its code and name (labels), its kind, the cry. */
export interface RallyCry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: TeamKind;
  readonly cry: string;
}

/** A pinned team, as far as the cries need it (core's `Pin` is one). */
export interface RallyPin {
  readonly id?: string;
  readonly code: string;
  readonly name: string;
}

/** The approved cries, keyed by the provider's id. Frozen. */
export const RALLY_CRIES: readonly RallyCry[] = freezeRows([
  { id: 'espn:203', code: 'MEX', name: 'Mexico', kind: 'nation', cry: '¿Y si sí?' },
  { id: 'espn:202', code: 'ARG', name: 'Argentina', kind: 'nation', cry: '¡Vamos, vamos Argentina!' },
  { id: 'espn:205', code: 'BRA', name: 'Brazil', kind: 'nation', cry: 'Vai Brasil!' },
  { id: 'espn:660', code: 'USA', name: 'United States', kind: 'nation', cry: 'I believe!' },
  { id: 'espn:448', code: 'ENG', name: 'England', kind: 'nation', cry: "It's coming home!" },
  { id: 'espn:478', code: 'FRA', name: 'France', kind: 'nation', cry: 'Allez les Bleus !' },
  { id: 'espn:164', code: 'ESP', name: 'Spain', kind: 'nation', cry: '¡A por ellos!' },
  { id: 'espn:481', code: 'GER', name: 'Germany', kind: 'nation', cry: "Auf geht's, Deutschland!" },
  { id: 'espn:482', code: 'POR', name: 'Portugal', kind: 'nation', cry: 'Força Portugal!' },
  { id: 'espn:208', code: 'COL', name: 'Colombia', kind: 'nation', cry: '¡Vamos Colombia!' },
  { id: 'espn:212', code: 'URU', name: 'Uruguay', kind: 'nation', cry: '¡Soy celeste!' },
  { id: 'espn:206', code: 'CAN', name: 'Canada', kind: 'nation', cry: 'Go Canada!' },
  { id: 'espn:627', code: 'JPN', name: 'Japan', kind: 'nation', cry: 'Nippon!' },
  { id: 'espn:451', code: 'KOR', name: 'South Korea', kind: 'nation', cry: 'Daehan Minguk!' },
  { id: 'espn:477', code: 'CRO', name: 'Croatia', kind: 'nation', cry: 'Hrvatska!' },
  { id: 'espn:449', code: 'NED', name: 'Netherlands', kind: 'nation', cry: 'Hup Holland Hup!' },
  { id: 'espn:459', code: 'BEL', name: 'Belgium', kind: 'nation', cry: 'Allez les Diables !' },
  { id: 'espn:209', code: 'ECU', name: 'Ecuador', kind: 'nation', cry: '¡Vamos Ecuador!' },
  { id: 'espn:233', code: 'UNAM', name: 'Pumas UNAM', kind: 'club', cry: '¡Goya!' },
  { id: 'espn:227', code: 'AME', name: 'América', kind: 'club', cry: '¡Ódiame más!' },
  { id: 'espn:219', code: 'GDL', name: 'Guadalajara', kind: 'club', cry: '¡Chivas, Chivas!' },
  { id: 'espn:218', code: 'CAZ', name: 'Cruz Azul', kind: 'club', cry: '¡Vamos Azul!' },
  { id: 'espn:232', code: 'UANL', name: 'Tigres UANL', kind: 'club', cry: '¡Tigres, Tigres!' },
  { id: 'espn:220', code: 'MTY', name: 'Monterrey', kind: 'club', cry: '¡Rayados!' },
  { id: 'espn:223', code: 'TOL', name: 'Toluca', kind: 'club', cry: '¡Diablos!' },
  { id: 'espn:225', code: 'SAN', name: 'Santos', kind: 'club', cry: '¡Guerreros!' },
  { id: 'espn:228', code: 'LEO', name: 'León', kind: 'club', cry: '¡Vamos Fiera!' },
  { id: 'espn:234', code: 'PAC', name: 'Pachuca', kind: 'club', cry: '¡Tuzos!' },
  { id: 'espn:216', code: 'ATS', name: 'Atlas', kind: 'club', cry: '¡Rojinegros!' },
  { id: 'espn:359', code: 'ARS', name: 'Arsenal', kind: 'club', cry: 'COYG!' },
  { id: 'espn:364', code: 'LIV', name: 'Liverpool', kind: 'club', cry: "You'll never walk alone!" },
  { id: 'espn:382', code: 'MNC', name: 'Manchester City', kind: 'club', cry: 'Blue Moon!' },
  { id: 'espn:360', code: 'MAN', name: 'Manchester United', kind: 'club', cry: 'Glory Glory Man United!' },
  { id: 'espn:363', code: 'CHE', name: 'Chelsea', kind: 'club', cry: 'Keep the blue flag flying high!' },
  { id: 'espn:367', code: 'TOT', name: 'Tottenham Hotspur', kind: 'club', cry: 'COYS!' },
  { id: 'espn:361', code: 'NEW', name: 'Newcastle United', kind: 'club', cry: 'Howay the lads!' },
  { id: 'espn:368', code: 'EVE', name: 'Everton', kind: 'club', cry: 'COYB!' },
  { id: 'espn:362', code: 'AVL', name: 'Aston Villa', kind: 'club', cry: 'UTV!' },
  { id: 'espn:357', code: 'LEE', name: 'Leeds United', kind: 'club', cry: 'Marching on together!' },
  { id: 'espn:86', code: 'RMA', name: 'Real Madrid', kind: 'club', cry: '¡Hala Madrid!' },
  { id: 'espn:83', code: 'BAR', name: 'Barcelona', kind: 'club', cry: 'Més que un club!' },
  { id: 'espn:1068', code: 'ATM', name: 'Atlético Madrid', kind: 'club', cry: '¡Aúpa Atleti!' },
  { id: 'espn:244', code: 'BET', name: 'Real Betis', kind: 'club', cry: '¡Viva er Betis manque pierda!' },
  { id: 'espn:93', code: 'ATH', name: 'Athletic Club', kind: 'club', cry: '¡Aúpa Athletic!' },
  { id: 'espn:243', code: 'SEV', name: 'Sevilla', kind: 'club', cry: '¡Vamos mi Sevilla!' },
  { id: 'espn:94', code: 'VAL', name: 'Valencia', kind: 'club', cry: '¡Amunt València!' },
  { id: 'espn:111', code: 'JUV', name: 'Juventus', kind: 'club', cry: 'Fino alla fine!' },
  { id: 'espn:110', code: 'INT', name: 'Internazionale', kind: 'club', cry: 'Forza Inter!' },
  { id: 'espn:103', code: 'MIL', name: 'AC Milan', kind: 'club', cry: 'Forza Milan!' },
  { id: 'espn:114', code: 'NAP', name: 'Napoli', kind: 'club', cry: 'Forza Napoli!' },
  { id: 'espn:104', code: 'ROMA', name: 'AS Roma', kind: 'club', cry: 'Daje Roma!' },
  { id: 'espn:132', code: 'MUN', name: 'Bayern Munich', kind: 'club', cry: 'Mia san mia!' },
  { id: 'espn:124', code: 'DOR', name: 'Borussia Dortmund', kind: 'club', cry: 'Echte Liebe!' },
  { id: 'espn:131', code: 'B04', name: 'Bayer Leverkusen', kind: 'club', cry: 'Werkself!' },
  { id: 'espn:160', code: 'PSG', name: 'Paris Saint-Germain', kind: 'club', cry: "Ici c'est Paris !" },
  { id: 'espn:5', code: 'CABJ', name: 'Boca Juniors', kind: 'club', cry: '¡Dale Boca!' },
  { id: 'espn:819', code: 'FLA', name: 'Flamengo', kind: 'club', cry: 'Mengo!' },
  { id: 'espn:2029', code: 'PAL', name: 'Palmeiras', kind: 'club', cry: 'Avanti Palestra!' },
  { id: 'espn:874', code: 'COR', name: 'Corinthians', kind: 'club', cry: 'Vai Corinthians!' },
  { id: 'espn:2683', code: 'PEN', name: 'Peñarol', kind: 'club', cry: '¡Vamos Carbonero!' },
]);

function freezeRows(rows: RallyCry[]): readonly RallyCry[] {
  for (const row of rows) Object.freeze(row);
  return Object.freeze(rows);
}

const BY_ID: ReadonlyMap<string, RallyCry> = new Map(RALLY_CRIES.map((c) => [c.id, c]));

/**
 * The table's entry for this side, in a competition whose teams are of
 * `kind`: by its id when it carries one, else (a nations competition only) by
 * its code and its name; undefined when it is no team of the table.
 */
export function rallyEntryFor(team: Team, kind: TeamKind): RallyCry | undefined {
  if (team.id !== undefined) {
    const entry = BY_ID.get(team.id);
    return entry !== undefined && entry.kind === kind ? entry : undefined;
  }
  if (kind !== 'nation') return undefined;
  return RALLY_CRIES.find((c) => c.kind === 'nation' && c.code === team.code && c.name === team.name);
}

/** Is this side the pinned team: by id when both carry one, else by code and name. */
function isPinned(team: Team, pin: RallyPin | undefined): boolean {
  if (pin === undefined) return false;
  if (team.id !== undefined && pin.id !== undefined) return team.id === pin.id;
  return team.code === pin.code && team.name === pin.name;
}

/**
 * The rally cry a match's line carries, or undefined when neither side has
 * one: the side's that has one; when both have one, the pinned side's when
 * the pin is one of them, else the home side's.
 */
export function rallyCryFor(m: Match, kind: TeamKind, pin?: RallyPin): string | undefined {
  const home = rallyEntryFor(m.home, kind);
  const away = rallyEntryFor(m.away, kind);
  if (home !== undefined && away !== undefined) {
    return isPinned(m.away, pin) && !isPinned(m.home, pin) ? away.cry : home.cry;
  }
  return (home ?? away)?.cry;
}
