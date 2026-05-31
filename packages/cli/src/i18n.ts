/** Minimal message catalog. Keys are stable; values localized. */
type Dict = Record<string, string>;

const EN: Dict = {
  'today.title': "Today's matches",
  'today.none': 'No matches scheduled for this date.',
  'live.title': 'Live now',
  'live.none': 'No matches in play right now.',
  'next.none': 'No upcoming fixture found for {team}.',
  'next.label': 'Next up for {team}',
  'next.in': 'in {countdown}',
  'table.title': 'Group {group}',
  'table.none': 'No group found for {group}.',
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
  disclaimer: 'Not affiliated with FIFA or Anthropic. Data: ESPN.',
};

const ES: Dict = {
  'today.title': 'Partidos de hoy',
  'today.none': 'No hay partidos para esta fecha.',
  'live.title': 'En vivo',
  'live.none': 'No hay partidos en juego ahora mismo.',
  'next.none': 'No se encontró próximo partido para {team}.',
  'next.label': 'Próximo de {team}',
  'next.in': 'en {countdown}',
  'table.title': 'Grupo {group}',
  'table.none': 'No se encontró el grupo {group}.',
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
  disclaimer: 'No afiliado a FIFA ni Anthropic. Datos: ESPN.',
};

const PT: Dict = {
  'today.title': 'Jogos de hoje',
  'today.none': 'Nenhum jogo para esta data.',
  'live.title': 'Ao vivo',
  'live.none': 'Nenhum jogo em andamento agora.',
  'next.none': 'Nenhum próximo jogo encontrado para {team}.',
  'next.label': 'Próximo de {team}',
  'next.in': 'em {countdown}',
  'table.title': 'Grupo {group}',
  'table.none': 'Grupo {group} não encontrado.',
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
  disclaimer: 'Não afiliado à FIFA nem à Anthropic. Dados: ESPN.',
};

const FR: Dict = {
  'today.title': "Matchs d'aujourd'hui",
  'today.none': 'Aucun match prévu pour cette date.',
  'live.title': 'En direct',
  'live.none': "Aucun match en cours pour l'instant.",
  'next.none': 'Aucun prochain match trouvé pour {team}.',
  'next.label': 'Prochain match de {team}',
  'next.in': 'dans {countdown}',
  'table.title': 'Groupe {group}',
  'table.none': 'Groupe {group} introuvable.',
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
  disclaimer: 'Non affilié à la FIFA ni à Anthropic. Données : ESPN.',
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
