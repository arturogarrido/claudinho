/**
 * A match's timeline as text rows: the ONE renderer of `Match.events`, printed
 * by the CLI's `match` (text and `--json`'s `lines`) and MCP `get_match`'s text.
 *
 * One row per event, in the events' order (time order, sealed): two spaces,
 * then aligned columns (the minute, `9'` or `90+3'`; the localized kind word;
 * the side's label, a club's code or a nation's flag and code), then two
 * spaces and the player when the provider named one. Widths are display
 * columns (`displayWidth`), so a flag pads like the terminal draws it. No
 * trailing space; no events, no rows (never a "no goals" sentence: the list is
 * what could be read, not a claim that it is every goal).
 */
import { t } from './i18n';
import { displayWidth, padVisible, withFlag } from './text';
import type { Match, MatchEvent } from './types';

const KIND_KEYS: Readonly<Record<MatchEvent['type'], string>> = Object.freeze({
  GOAL: 'event.goal',
  OWN_GOAL: 'event.ownGoal',
  PEN: 'event.penalty',
  YELLOW: 'event.yellow',
  RED: 'event.red',
  SUB: 'event.sub',
});

export interface TimelineOptions {
  /** The reader's language (en/es/pt/fr); English when absent. */
  readonly lang?: string;
  /** Whether a nation's flag is printed beside its code (a club has none either way). */
  readonly flags: boolean;
}

/** The match's events as aligned text rows; `[]` when it has none. */
export function timelineRows(match: Match, opts: TimelineOptions): string[] {
  const events = match.events ?? [];
  if (events.length === 0) return [];
  const cells = events.map((e) => {
    const team = e.side === 'home' ? match.home : match.away;
    return {
      minute: e.added !== undefined ? `${e.minute}+${e.added}'` : `${e.minute}'`,
      kind: t(opts.lang, KIND_KEYS[e.type]),
      label: withFlag(team.code, opts.flags ? team.flag : undefined, e.side),
      player: e.player,
    };
  });
  const widest = (pick: (c: (typeof cells)[number]) => string) => Math.max(...cells.map((c) => displayWidth(pick(c))));
  const minuteW = widest((c) => c.minute);
  const kindW = widest((c) => c.kind);
  const labelW = widest((c) => c.label);
  return cells.map((c) =>
    `  ${padVisible(c.minute, minuteW)}  ${padVisible(c.kind, kindW)}  ${padVisible(c.label, labelW)}${c.player ? `  ${c.player}` : ''}`.trimEnd(),
  );
}

/** The kinds that score: an own goal for the side it credited (its `side`), a penalty as a goal. */
const SCORING = new Set<MatchEvent['type']>(['GOAL', 'OWN_GOAL', 'PEN']);

/**
 * The goal that made the record's score, PROVEN, or `null`. The record's
 * scoring events, counted per side in their order (an own goal for the side
 * it credited, which is the event's `side`), must equal its regulation score:
 * then the timeline is whole and its last scoring event is the goal that made
 * this score. Anything else proves nothing (a timeline that lags the score, a
 * disallowed goal still listed, no score, no scoring event): the first scorer
 * is never named for a second goal. Two scoring events identical in type,
 * minute, added time, side and player prove nothing either: the same goal
 * listed twice beside a timeline that lags would count as two. The ambient
 * view's `lastGoal`, written by the refresher on each live record it
 * publishes.
 */
export function provenLastGoal(match: Match): MatchEvent | null {
  const score = match.score;
  if (!score) return null;
  let home = 0;
  let away = 0;
  let last: MatchEvent | null = null;
  const identities = new Set<string>();
  for (const e of match.events ?? []) {
    if (!SCORING.has(e.type)) continue;
    const identity = JSON.stringify([e.type, e.minute, e.added ?? 0, e.side, e.player ?? null]);
    if (identities.has(identity)) return null;
    identities.add(identity);
    if (e.side === 'home') home++;
    else if (e.side === 'away') away++;
    else continue;
    last = e;
  }
  return last !== null && home === score.home && away === score.away ? last : null;
}
