import type { Match } from './types';

/** Supported UI locales — same set as CLI/MCP `lang`. */
export type Lang = 'en' | 'es' | 'pt' | 'fr';

const EN = {
  'bracket.title': 'Knockout bracket',
  'bracket.stageTitle': 'Knockout · {stage}',
  'bracket.shareTitle': 'Knockout bracket · 2026',
  'bracket.degraded':
    'Live scores unavailable — bracket structure only, no confirmed advancement.',
  'bracket.standingsDegraded':
    'Live standings unavailable — group slots stay TBD until groups finish.',
  'bracket.treeFallback': 'Terminal too narrow for tree view — showing staged list.',
  'bracket.empty': 'No bracket matches available.',
  'bracket.projected': '(proj.)',
  'bracket.invalidStage': 'Stage must be one of: R32, R16, QF, SF, 3P, F',
  'bracket.unknownStage': 'Unknown stage "{stage}". Use R32, R16, QF, SF, 3P, or F.',
  'bracket.slot.groupWinner': 'Group {group} winner',
  'bracket.slot.groupSecond': 'Group {group} 2nd',
  'bracket.slot.third': '3rd ({groups})',
  'bracket.slot.winner': '{stage} {n} winner',
  'bracket.slot.loser': '{stage} {n} loser',
  'bracket.slot.tbd': 'TBD',
  'live.data': 'Live data: {source}',
  'standings.unavailable': 'Live standings unavailable.',
  'standings.partial': 'Partial table — {n} rows could not be read.',
  'standings.incomplete': 'Some tables could not be read — this is not the whole competition.',
  'standings.none': 'No group "{group}".',
  'standings.empty': 'No standings available.',
  'competition.unsupported': 'Not available for this competition yet.',
  'competition.noBracket': 'This competition has no bracket.',
  'team.unknown': "No team called {team} in the competition's table or in its fixtures over the next {days} days.",
  'team.unknownNation': "No team called {team} among the World Cup's nations.",
  'roster.incomplete': "The competition's roster could not be read whole, so {team} could not be resolved; try the club's full name.",
  'edition.between': 'Between editions: the {label} edition ended on {date}.',
  'next.horizon': 'No fixture for {team} within the next {days} days.',
  'match.notFoundBetween': 'Not found between {from} and {to}: no match with id {id} in that span.',
  'next.noneRead': 'No fixture for {team} was read in this span.',
  'match.noneRead': 'No match with id {id} was read in this span.',
  'read.partial': 'Fixture data may be incomplete.',
  'read.partial.one': 'Fixture data may be incomplete ({n} provider record omitted).',
  'read.partial.other': 'Fixture data may be incomplete ({n} provider records omitted).',
  'live.noneRead': 'No match in play was read.',
  'today.noneRead': 'No fixture was read for {date}.',
  'today.unreached': "Couldn't reach the data provider — no fixtures confirmed for {date}.",
  'today.unserved.one': '{n} fixture shown from the bundled schedule; its live state is unconfirmed.',
  'today.unserved.other': '{n} fixtures shown from the bundled schedule; their live state is unconfirmed.',
  'share.tryIt': 'Try it: {line}',
  'stage.group': 'Group {group}',
  'stage.groupStage': 'Group stage',
  'stage.r32': 'Round of 32',
  'stage.r16': 'Round of 16',
  'stage.qf': 'Quarter-final',
  'stage.sf': 'Semi-final',
  'stage.3p': 'Third-place play-off',
  'stage.f': 'Final',
  'stage.friendly': 'Friendly',
  'stage.regular': 'League',
  'stage.league': 'League phase',
  'stage.po': 'Play-offs',
};

/**
 * Every locale must define exactly the EN key set — a missing or mistyped
 * es/pt/fr key fails `tsc` instead of silently rendering mid-sentence English
 * at runtime (the fallback in `t()` stays, but only for genuinely unknown keys).
 */
type Dict = Record<keyof typeof EN, string>;

const ES: Dict = {
  'bracket.title': 'Cuadro de eliminatorias',
  'bracket.stageTitle': 'Eliminatorias · {stage}',
  'bracket.shareTitle': 'Cuadro de eliminatorias · 2026',
  'bracket.degraded':
    'Marcadores en vivo no disponibles — solo estructura del cuadro, sin avances confirmados.',
  'bracket.standingsDegraded':
    'Tabla en vivo no disponible — los cupos de grupo siguen por definir hasta que terminen los grupos.',
  'bracket.treeFallback': 'Terminal demasiado estrecha para el árbol — mostrando lista por fase.',
  'bracket.empty': 'No hay partidos de eliminatorias disponibles.',
  'bracket.projected': '(proy.)',
  'bracket.invalidStage': 'La fase debe ser una de: R32, R16, QF, SF, 3P, F',
  'bracket.unknownStage': 'Fase desconocida "{stage}". Usa R32, R16, QF, SF, 3P o F.',
  'bracket.slot.groupWinner': 'Ganador del grupo {group}',
  'bracket.slot.groupSecond': '2º del grupo {group}',
  'bracket.slot.third': '3º ({groups})',
  'bracket.slot.winner': 'Ganador {stage} {n}',
  'bracket.slot.loser': 'Perdedor {stage} {n}',
  'bracket.slot.tbd': 'Por definir',
  'live.data': 'Datos en vivo: {source}',
  'standings.unavailable': 'Tabla en vivo no disponible.',
  'standings.partial': 'Tabla parcial — no se pudieron leer {n} filas.',
  'standings.incomplete': 'No se pudieron leer algunas tablas — esta no es la competición completa.',
  'standings.none': 'No se encontró el grupo "{group}".',
  'standings.empty': 'No hay clasificación disponible.',
  'competition.unsupported': 'Aún no disponible para esta competición.',
  'competition.noBracket': 'Esta competición no tiene cuadro de eliminatorias.',
  'team.unknown': 'Ningún equipo se llama {team} en la tabla de la competición ni en sus partidos de los próximos {days} días.',
  'team.unknownNation': 'Ninguna selección se llama {team} entre las del Mundial.',
  'roster.incomplete': 'No se pudo leer completa la lista de equipos de la competición, así que no se pudo identificar a {team}; prueba con el nombre completo del club.',
  'edition.between': 'Entre ediciones: la edición {label} terminó el {date}.',
  'next.horizon': 'Ningún partido de {team} en los próximos {days} días.',
  'match.notFoundBetween': 'No se encontró entre {from} y {to}: ningún partido con id {id} en ese período.',
  'next.noneRead': 'No se leyó ningún partido de {team} en este período.',
  'match.noneRead': 'No se leyó ningún partido con id {id} en este período.',
  'read.partial': 'Los datos de los partidos pueden estar incompletos.',
  'read.partial.one': 'Los datos de los partidos pueden estar incompletos (se omitió {n} registro del proveedor).',
  'read.partial.other': 'Los datos de los partidos pueden estar incompletos (se omitieron {n} registros del proveedor).',
  'live.noneRead': 'No se leyó ningún partido en juego.',
  'today.noneRead': 'No se leyó ningún partido para el {date}.',
  'today.unreached': 'No se pudo contactar al proveedor de datos — ningún partido confirmado para el {date}.',
  'today.unserved.one': '{n} partido mostrado del calendario incluido; su estado en vivo no está confirmado.',
  'today.unserved.other': '{n} partidos mostrados del calendario incluido; su estado en vivo no está confirmado.',
  'share.tryIt': 'Pruébalo: {line}',
  'stage.group': 'Grupo {group}',
  'stage.groupStage': 'Fase de grupos',
  'stage.r32': 'Dieciseisavos de final',
  'stage.r16': 'Octavos de final',
  'stage.qf': 'Cuartos de final',
  'stage.sf': 'Semifinal',
  'stage.3p': 'Tercer puesto',
  'stage.f': 'Final',
  'stage.friendly': 'Amistoso',
  'stage.regular': 'Liga',
  'stage.league': 'Fase de liga',
  'stage.po': 'Play-offs',
};

const PT: Dict = {
  'bracket.title': 'Chave do mata-mata',
  'bracket.stageTitle': 'Mata-mata · {stage}',
  'bracket.shareTitle': 'Chave do mata-mata · 2026',
  'bracket.degraded':
    'Placar ao vivo indisponível — apenas a estrutura da chave, sem avanços confirmados.',
  'bracket.standingsDegraded':
    'Classificação ao vivo indisponível — vagas de grupo seguem a definir até o fim dos grupos.',
  'bracket.treeFallback': 'Terminal estreito demais para a árvore — mostrando lista por fase.',
  'bracket.empty': 'Nenhum jogo do mata-mata disponível.',
  'bracket.projected': '(proj.)',
  'bracket.invalidStage': 'A fase deve ser uma de: R32, R16, QF, SF, 3P, F',
  'bracket.unknownStage': 'Fase desconhecida "{stage}". Use R32, R16, QF, SF, 3P ou F.',
  'bracket.slot.groupWinner': 'Vencedor do grupo {group}',
  'bracket.slot.groupSecond': '2.º do grupo {group}',
  'bracket.slot.third': '3.º ({groups})',
  'bracket.slot.winner': 'Vencedor {stage} {n}',
  'bracket.slot.loser': 'Perdedor {stage} {n}',
  'bracket.slot.tbd': 'A definir',
  'live.data': 'Dados ao vivo: {source}',
  'standings.unavailable': 'Classificação ao vivo indisponível.',
  'standings.partial': 'Tabela parcial — {n} linhas não puderam ser lidas.',
  'standings.incomplete': 'Algumas tabelas não puderam ser lidas — esta não é a competição completa.',
  'standings.none': 'Grupo "{group}" não encontrado.',
  'standings.empty': 'Não há classificação disponível.',
  'competition.unsupported': 'Ainda não disponível para esta competição.',
  'competition.noBracket': 'Esta competição não tem chave de mata-mata.',
  'team.unknown': 'Nenhum time chamado {team} na tabela da competição nem nos seus jogos dos próximos {days} dias.',
  'team.unknownNation': 'Nenhuma seleção chamada {team} entre as da Copa do Mundo.',
  'roster.incomplete': 'Não foi possível ler por completo a lista de times da competição, então {team} não pôde ser identificado; tente o nome completo do clube.',
  'edition.between': 'Entre edições: a edição {label} terminou em {date}.',
  'next.horizon': 'Nenhum jogo de {team} nos próximos {days} dias.',
  'match.notFoundBetween': 'Não encontrado entre {from} e {to}: nenhum jogo com id {id} nesse período.',
  'next.noneRead': 'Nenhum jogo de {team} foi lido neste período.',
  'match.noneRead': 'Nenhum jogo com id {id} foi lido neste período.',
  'read.partial': 'Os dados dos jogos podem estar incompletos.',
  'read.partial.one': 'Os dados dos jogos podem estar incompletos ({n} registro do provedor omitido).',
  'read.partial.other': 'Os dados dos jogos podem estar incompletos ({n} registros do provedor omitidos).',
  'live.noneRead': 'Nenhum jogo em andamento foi lido.',
  'today.noneRead': 'Nenhum jogo foi lido para {date}.',
  'today.unreached': 'Não foi possível contatar o provedor de dados — nenhum jogo confirmado para {date}.',
  'today.unserved.one': '{n} jogo exibido do calendário incluído; seu estado ao vivo não foi confirmado.',
  'today.unserved.other': '{n} jogos exibidos do calendário incluído; o estado ao vivo deles não foi confirmado.',
  'share.tryIt': 'Experimente: {line}',
  'stage.group': 'Grupo {group}',
  'stage.groupStage': 'Fase de grupos',
  'stage.r32': 'Fase de 32 equipes',
  'stage.r16': 'Oitavas de final',
  'stage.qf': 'Quartas de final',
  'stage.sf': 'Semifinal',
  'stage.3p': 'Disputa do 3.º lugar',
  'stage.f': 'Final',
  'stage.friendly': 'Amistoso',
  'stage.regular': 'Liga',
  'stage.league': 'Fase de liga',
  'stage.po': 'Play-offs',
};

const FR: Dict = {
  'bracket.title': 'Tableau à élimination directe',
  'bracket.stageTitle': 'Éliminatoires · {stage}',
  'bracket.shareTitle': 'Tableau à élimination directe · 2026',
  'bracket.degraded':
    'Scores en direct indisponibles — structure du tableau seulement, aucune qualification confirmée.',
  'bracket.standingsDegraded':
    'Classement en direct indisponible — les places de groupe restent à définir jusqu’à la fin des poules.',
  'bracket.treeFallback': 'Terminal trop étroit pour l’arbre — affichage par phase.',
  'bracket.empty': 'Aucun match à élimination directe disponible.',
  'bracket.projected': '(proj.)',
  'bracket.invalidStage': 'La phase doit être l’une de : R32, R16, QF, SF, 3P, F',
  'bracket.unknownStage': 'Phase inconnue « {stage} ». Utilisez R32, R16, QF, SF, 3P ou F.',
  'bracket.slot.groupWinner': 'Vainqueur du groupe {group}',
  'bracket.slot.groupSecond': '2e du groupe {group}',
  'bracket.slot.third': '3e ({groups})',
  'bracket.slot.winner': 'Vainqueur {stage} {n}',
  'bracket.slot.loser': 'Perdant {stage} {n}',
  'bracket.slot.tbd': 'À définir',
  'live.data': 'Données en direct : {source}',
  'standings.unavailable': 'Classement en direct indisponible.',
  'standings.partial': 'Classement partiel — {n} lignes n\'ont pas pu être lues.',
  'standings.incomplete': 'Certains classements n\'ont pas pu être lus — ce n\'est pas la compétition complète.',
  'standings.none': 'Groupe "{group}" introuvable.',
  'standings.empty': 'Aucun classement disponible.',
  'competition.unsupported': 'Pas encore disponible pour cette compétition.',
  'competition.noBracket': 'Cette compétition n’a pas de tableau à élimination directe.',
  'team.unknown': 'Aucune équipe nommée {team} dans le classement de la compétition ni dans ses matchs des {days} prochains jours.',
  'team.unknownNation': 'Aucune nation nommée {team} parmi celles de la Coupe du monde.',
  'roster.incomplete': 'La liste des équipes de la compétition n’a pas pu être lue en entier : {team} n’a pas pu être identifié ; essayez le nom complet du club.',
  'edition.between': 'Entre deux éditions : l’édition {label} s’est terminée le {date}.',
  'next.horizon': 'Aucun match pour {team} dans les {days} prochains jours.',
  'match.notFoundBetween': 'Introuvable entre le {from} et le {to} : aucun match avec l’id {id} sur cette période.',
  'next.noneRead': 'Aucun match de {team} n’a été lu sur cette période.',
  'match.noneRead': 'Aucun match avec l’id {id} n’a été lu sur cette période.',
  'read.partial': 'Les données des matchs peuvent être incomplètes.',
  'read.partial.one': 'Les données des matchs peuvent être incomplètes ({n} enregistrement du fournisseur omis).',
  'read.partial.other': 'Les données des matchs peuvent être incomplètes ({n} enregistrements du fournisseur omis).',
  'live.noneRead': 'Aucun match en cours n’a été lu.',
  'today.noneRead': 'Aucun match n’a été lu pour le {date}.',
  'today.unreached': 'Impossible de joindre le fournisseur de données — aucun match confirmé pour le {date}.',
  'today.unserved.one': '{n} match affiché depuis le calendrier intégré ; son état en direct n’est pas confirmé.',
  'today.unserved.other': '{n} matchs affichés depuis le calendrier intégré ; leur état en direct n’est pas confirmé.',
  'share.tryIt': 'Essayez : {line}',
  'stage.group': 'Groupe {group}',
  'stage.groupStage': 'Phase de groupes',
  'stage.r32': 'Seizièmes de finale',
  'stage.r16': 'Huitièmes de finale',
  'stage.qf': 'Quarts de finale',
  'stage.sf': 'Demi-finale',
  'stage.3p': 'Match pour la 3e place',
  'stage.f': 'Finale',
  'stage.friendly': 'Match amical',
  'stage.regular': 'Championnat',
  'stage.league': 'Phase de ligue',
  'stage.po': 'Barrages',
};

const CATALOGS: Record<Lang, Dict> = { en: EN, es: ES, pt: PT, fr: FR };

/** Normalize MCP/CLI `lang` to a supported catalog (falls back to English). */
export function normalizeLang(lang?: string): Lang {
  const code = (lang ?? 'en').slice(0, 2).toLowerCase();
  if (code === 'es' || code === 'pt' || code === 'fr') return code;
  return 'en';
}

/** Translate a message key with optional `{placeholder}` interpolation. */
export function t(lang: string | undefined, key: string, vars?: Record<string, string>): string {
  // Widen for lookup: callers pass arbitrary string keys (unknown → key echo).
  const dict: Record<string, string> = CATALOGS[normalizeLang(lang)];
  const en: Record<string, string> = EN;
  const s = dict[key] ?? en[key] ?? key;
  if (!vars) return s;
  // ONE pass over the template: a value is inserted as it is and never read
  // again as a template, so a reader's query that looks like a placeholder
  // ("Club {days}") is printed as typed. A placeholder with no value stays.
  return s.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? (vars[name] as string) : whole,
  );
}

const STAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  GROUP: 'stage.groupStage',
  R32: 'stage.r32',
  R16: 'stage.r16',
  QF: 'stage.qf',
  SF: 'stage.sf',
  '3P': 'stage.3p',
  F: 'stage.f',
  FRIENDLY: 'stage.friendly',
  REGULAR: 'stage.regular',
  LEAGUE: 'stage.league',
  PO: 'stage.po',
});

/**
 * Localized stage label, from the match (its stage, its group letter under the
 * group stage, and the words an OTHER stage carries). An `OTHER` stage prints
 * the provider's own words untranslated, or NOTHING when it carries none: a
 * caller that joins a stage into a line drops an empty one with its separator.
 * A bare stage (a bracket round, a `bracket <stage>` filter) is passed as
 * `{ stage }`.
 */
export function stageLabelI18n(
  lang: string | undefined,
  m: Pick<Match, 'stage' | 'group' | 'stageLabel'>,
): string {
  // A group letter belongs to the group stage (the seal drops one elsewhere).
  if (m.group && m.stage === 'GROUP') return t(lang, 'stage.group', { group: m.group });
  if (m.stage === 'OTHER') return m.stageLabel ?? '';
  // OWN-property lookup: a stage typed by a reader can be any string.
  const key = Object.hasOwn(STAGE_KEYS, m.stage) ? STAGE_KEYS[m.stage] : undefined;
  return key ? t(lang, key) : m.stage;
}
