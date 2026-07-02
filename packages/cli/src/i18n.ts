/** Minimal message catalog. Keys are stable; values localized. */
const EN = {
  'today.title': "Today's matches",
  'today.on': 'Matches',
  'today.none': 'No matches scheduled for this date.',
  'live.title': 'Live now',
  'live.none': 'No matches in play right now.',
  'live.degraded': "Live scores unavailable right now — couldn't reach the data provider.",
  'feed.degraded': 'Live scores unavailable — showing the bundled schedule.',
  'next.none': 'No upcoming fixture found for {team}.',
  'next.label': 'Next up for {team}',
  'next.in': 'in {countdown}',
  'team.group': 'Group {group}',
  'team.ambiguous': '"{query}" is ambiguous. Did you mean:',
  'team.none': 'No team found for "{query}". Try a nation name or 3-letter code (e.g. Mexico, MEX).',
  'team.usage': 'Usage: claudinho team <name or code> (e.g. claudinho team Mexico)',
  'table.title': 'Group {group}',
  'table.none': 'No group found for {group}.',
  'table.degraded': 'Live standings unavailable — showing the group roster.',
  'table.empty': 'No standings available.',
  'match.none': 'No match found with id {id}.',
  'status.live': 'LIVE',
  'status.ht': 'HT',
  'status.ft': 'FT',
  'status.postponed': 'postponed',
  'status.cancelled': 'cancelled',
  'col.team': 'Team',
  'col.p': 'P',
  'col.w': 'W',
  'col.d': 'D',
  'col.l': 'L',
  'col.gd': 'GD',
  'col.pts': 'Pts',
  'err.date': 'Invalid date {date}. Use YYYY-MM-DD.',
  'warn.tz': 'Unknown timezone {tz}; using system timezone.',
  'warn.lang': 'Unsupported language {lang}; using English. (supported: en, es, pt, fr)',
  disclaimer: 'Not affiliated with FIFA or Anthropic.',
};

/**
 * Every locale must define exactly the EN key set — a missing or mistyped
 * es/pt/fr key fails `tsc` instead of silently rendering mid-sentence English
 * at runtime (the fallback below stays, but only for genuinely unknown keys).
 */
type Dict = Record<keyof typeof EN, string>;

const ES: Dict = {
  'today.title': 'Partidos de hoy',
  'today.on': 'Partidos',
  'today.none': 'No hay partidos para esta fecha.',
  'live.title': 'En vivo',
  'live.none': 'No hay partidos en juego ahora mismo.',
  'live.degraded': 'Marcadores en vivo no disponibles — no se pudo conectar con el proveedor de datos.',
  'feed.degraded': 'Marcadores en vivo no disponibles — mostrando el calendario.',
  'next.none': 'No se encontró próximo partido para {team}.',
  'next.label': 'Próximo partido de {team}',
  'next.in': 'en {countdown}',
  'team.group': 'Grupo {group}',
  'team.ambiguous': '"{query}" es ambiguo. ¿Quisiste decir:',
  'team.none': 'No se encontró ningún equipo para "{query}". Prueba un nombre de país o un código de 3 letras (p. ej. Mexico, MEX).',
  'team.usage': 'Uso: claudinho team <nombre o código> (p. ej. claudinho team Mexico)',
  'table.title': 'Grupo {group}',
  'table.none': 'No se encontró el grupo {group}.',
  'table.degraded': 'Tabla en vivo no disponible — mostrando la lista del grupo.',
  'table.empty': 'No hay clasificación disponible.',
  'match.none': 'No se encontró partido con id {id}.',
  'status.live': 'EN VIVO',
  'status.ht': 'DESC',
  'status.ft': 'FIN',
  'status.postponed': 'aplazado',
  'status.cancelled': 'cancelado',
  'col.team': 'Equipo',
  'col.p': 'PJ',
  'col.w': 'G',
  'col.d': 'E',
  'col.l': 'P',
  'col.gd': 'DG',
  'col.pts': 'Pts',
  'err.date': 'Fecha inválida {date}. Usa AAAA-MM-DD.',
  'warn.tz': 'Zona horaria desconocida {tz}; usando la del sistema.',
  'warn.lang': 'Idioma no soportado {lang}; usando inglés. (disponibles: en, es, pt, fr)',
  disclaimer: 'No afiliado a FIFA ni Anthropic.',
};

const PT: Dict = {
  'today.title': 'Jogos de hoje',
  'today.on': 'Jogos',
  'today.none': 'Nenhum jogo para esta data.',
  'live.title': 'Ao vivo',
  'live.none': 'Nenhum jogo em andamento agora.',
  'live.degraded': 'Placar ao vivo indisponível — não foi possível conectar ao provedor de dados.',
  'feed.degraded': 'Placar ao vivo indisponível — mostrando a tabela de jogos.',
  'next.none': 'Nenhum próximo jogo encontrado para {team}.',
  'next.label': 'Próximo jogo de {team}',
  'next.in': 'em {countdown}',
  'team.group': 'Grupo {group}',
  'team.ambiguous': '"{query}" é ambíguo. Você quis dizer:',
  'team.none': 'Nenhuma seleção encontrada para "{query}". Tente um nome de país ou um código de 3 letras (ex. Mexico, MEX).',
  'team.usage': 'Uso: claudinho team <nome ou código> (ex. claudinho team Mexico)',
  'table.title': 'Grupo {group}',
  'table.none': 'Grupo {group} não encontrado.',
  'table.degraded': 'Classificação ao vivo indisponível — mostrando os times do grupo.',
  'table.empty': 'Classificação indisponível.',
  'match.none': 'Nenhum jogo encontrado com id {id}.',
  'status.live': 'AO VIVO',
  'status.ht': 'INT',
  'status.ft': 'FIM',
  'status.postponed': 'adiado',
  'status.cancelled': 'cancelado',
  'col.team': 'Seleção',
  'col.p': 'J',
  'col.w': 'V',
  'col.d': 'E',
  'col.l': 'D',
  'col.gd': 'SG',
  'col.pts': 'Pts',
  'err.date': 'Data inválida {date}. Use AAAA-MM-DD.',
  'warn.tz': 'Fuso horário desconhecido {tz}; usando o do sistema.',
  'warn.lang': 'Idioma não suportado {lang}; usando inglês. (disponíveis: en, es, pt, fr)',
  disclaimer: 'Não afiliado à FIFA nem à Anthropic.',
};

const FR: Dict = {
  'today.title': "Matchs d'aujourd'hui",
  'today.on': 'Matchs',
  'today.none': 'Aucun match prévu pour cette date.',
  'live.title': 'En direct',
  'live.none': "Aucun match en cours pour l'instant.",
  'live.degraded': 'Scores en direct indisponibles — impossible de joindre le fournisseur de données.',
  'feed.degraded': 'Scores en direct indisponibles — affichage du calendrier.',
  'next.none': 'Aucun prochain match trouvé pour {team}.',
  'next.label': 'Prochain match de {team}',
  'next.in': 'dans {countdown}',
  'team.group': 'Groupe {group}',
  'team.ambiguous': '"{query}" est ambigu. Vouliez-vous dire :',
  'team.none': 'Aucune équipe trouvée pour "{query}". Essayez un nom de pays ou un code à 3 lettres (p. ex. Mexico, MEX).',
  'team.usage': 'Usage : claudinho team <nom ou code> (p. ex. claudinho team Mexico)',
  'table.title': 'Groupe {group}',
  'table.none': 'Groupe {group} introuvable.',
  'table.degraded': 'Classement en direct indisponible — affichage de la composition du groupe.',
  'table.empty': 'Aucun classement disponible.',
  'match.none': 'Aucun match trouvé avec id {id}.',
  'status.live': 'DIRECT',
  'status.ht': 'MT',
  'status.ft': 'FIN',
  'status.postponed': 'reporté',
  'status.cancelled': 'annulé',
  'col.team': 'Équipe',
  'col.p': 'J',
  'col.w': 'G',
  'col.d': 'N',
  'col.l': 'P',
  'col.gd': 'Diff',
  'col.pts': 'Pts',
  'err.date': 'Date invalide {date}. Utilisez AAAA-MM-JJ.',
  'warn.tz': 'Fuseau horaire inconnu {tz} ; utilisation du fuseau système.',
  'warn.lang': 'Langue non prise en charge {lang} ; utilisation de l’anglais. (disponibles : en, es, pt, fr)',
  disclaimer: 'Non affilié à la FIFA ni à Anthropic.',
};

const CATALOGS: Record<string, Dict> = { en: EN, es: ES, pt: PT, fr: FR };

/** Translator bound to a locale, with simple {placeholder} interpolation. */
export function makeT(lang: string) {
  // Widen for lookup: callers pass arbitrary string keys (unknown → key echo).
  const dict: Record<string, string> = CATALOGS[lang] ?? EN;
  const en: Record<string, string> = EN;
  return (key: string, vars?: Record<string, string>): string => {
    let s = dict[key] ?? en[key] ?? key;
    // replaceAll (matching core's t()) so a repeated placeholder fills every slot.
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  };
}

export type Translator = ReturnType<typeof makeT>;
