/** Minimal message catalog. Keys are stable; values localized. */
type Dict = Record<string, string>;

const EN: Dict = {
  'today.title': "Today's matches",
  'today.on': 'Matches',
  'today.none': 'No matches scheduled for this date.',
  'live.title': 'Live now',
  'live.none': 'No matches in play right now.',
  'next.none': 'No upcoming fixture found for {team}.',
  'next.label': 'Next up for {team}',
  'next.in': 'in {countdown}',
  'table.title': 'Group {group}',
  'table.none': 'No group found for {group}.',
  'table.degraded': 'Live standings unavailable — showing the group roster.',
  'match.none': 'No match found with id {id}.',
  'status.scheduled': 'scheduled',
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

const ES: Dict = {
  'today.title': 'Partidos de hoy',
  'today.on': 'Partidos',
  'today.none': 'No hay partidos para esta fecha.',
  'live.title': 'En vivo',
  'live.none': 'No hay partidos en juego ahora mismo.',
  'next.none': 'No se encontró próximo partido para {team}.',
  'next.label': 'Próximo partido de {team}',
  'next.in': 'en {countdown}',
  'table.title': 'Grupo {group}',
  'table.none': 'No se encontró el grupo {group}.',
  'table.degraded': 'Tabla en vivo no disponible — mostrando la lista del grupo.',
  'match.none': 'No se encontró partido con id {id}.',
  'status.scheduled': 'programado',
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
  'next.none': 'Nenhum próximo jogo encontrado para {team}.',
  'next.label': 'Próximo jogo de {team}',
  'next.in': 'em {countdown}',
  'table.title': 'Grupo {group}',
  'table.none': 'Grupo {group} não encontrado.',
  'table.degraded': 'Classificação ao vivo indisponível — mostrando os times do grupo.',
  'match.none': 'Nenhum jogo encontrado com id {id}.',
  'status.scheduled': 'agendado',
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
  'next.none': 'Aucun prochain match trouvé pour {team}.',
  'next.label': 'Prochain match de {team}',
  'next.in': 'dans {countdown}',
  'table.title': 'Groupe {group}',
  'table.none': 'Groupe {group} introuvable.',
  'table.degraded': 'Classement en direct indisponible — affichage de la composition du groupe.',
  'match.none': 'Aucun match trouvé avec id {id}.',
  'status.scheduled': 'prévu',
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
  const dict = CATALOGS[lang] ?? EN;
  return (key: string, vars?: Record<string, string>): string => {
    let s = dict[key] ?? EN[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
}

export type Translator = ReturnType<typeof makeT>;
