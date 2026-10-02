/**
 * The schedule INDEX: one small record per fixture the refresher knows about,
 * sealed here whether it was just read from a provider or read back from our
 * own cache file. It is what decides, off the bundled competition, whether a
 * match can be in play — so a record carries exactly what that decision needs
 * and nothing a file could use to stretch it: a window is always the kickoff
 * plus a fixed length, never a stored end.
 */
import type { Match, Status } from '../types';
import { canonicalTimestamp, ESPN_ID, opaqueId } from './roles';

/** One fixture the schedule knows: its id, its kickoff, and whether it has a live window. */
export interface ScheduleEntry {
  readonly id: string;
  /** A canonical instant. */
  readonly kickoff: string;
  /** False for a postponed, cancelled or finished fixture: known, and opening no window. */
  readonly on: boolean;
}

/**
 * Whether a fixture in this status has a live window: not postponed, not
 * cancelled, and not finished (nothing is left to poll for, and nothing to call
 * live). THE rule, for the index (`scheduleEntryOf`) and for the statusline
 * reading the slice's display records. A match seen IN PLAY is held by the
 * refresher's continuation, not by its entry.
 */
export function hasLiveWindow(status: Status): boolean {
  return status !== 'POSTPONED' && status !== 'CANCELLED' && status !== 'FT';
}

/**
 * The most records an index holds. A 16-day span of the busiest competition
 * measured holds about 80. An index is whole or it does not exist: a longer
 * one is not cut somewhere, it is no schedule.
 */
export const MAX_SCHEDULE_INDEX = 256;

/** THE constructor of a schedule entry. */
export function sealScheduleEntry(raw: unknown): ScheduleEntry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const id = opaqueId(r.id, ESPN_ID);
  const kickoff = canonicalTimestamp(r.kickoff);
  if (!id || !kickoff || typeof r.on !== 'boolean') return undefined;
  return { id, kickoff, on: r.on };
}

/** A fixture's entry; none if the fixture has no id or no instant. */
export function scheduleEntryOf(m: Match): ScheduleEntry | undefined {
  return sealScheduleEntry({
    id: m.id,
    kickoff: m.kickoff,
    on: hasLiveWindow(m.status),
  });
}

/**
 * A stored index, read back. Not a list, or longer than the bound: no schedule
 * at all (decided before a record is looked at; never read as a prefix). A
 * record that cannot be sealed does not count; an id held twice counts once,
 * the first. In kickoff order.
 */
export function parseCachedScheduleIndex(raw: unknown): ScheduleEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_SCHEDULE_INDEX) return undefined;
  const seen = new Set<string>();
  const out: ScheduleEntry[] = [];
  for (const rec of raw) {
    const entry = sealScheduleEntry(rec);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
