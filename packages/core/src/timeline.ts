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
