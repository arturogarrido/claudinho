/** Supported UI locales — same set as CLI/MCP `lang`. */
export type Lang = 'en' | 'es' | 'pt' | 'fr';

type Dict = Record<string, string>;

const EN: Dict = {
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
};

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
  const dict = CATALOGS[normalizeLang(lang)];
  let s = dict[key] ?? EN[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

const STAGE_KEYS: Record<string, string> = {
  GROUP: 'stage.groupStage',
  R32: 'stage.r32',
  R16: 'stage.r16',
  QF: 'stage.qf',
  SF: 'stage.sf',
  '3P': 'stage.3p',
  F: 'stage.f',
  FRIENDLY: 'stage.friendly',
};

/** Localized knockout/group stage label for bracket rendering. */
export function stageLabelI18n(lang: string | undefined, stage: string, group?: string): string {
  if (group) return t(lang, 'stage.group', { group });
  const key = STAGE_KEYS[stage];
  return key ? t(lang, key) : stage;
}
