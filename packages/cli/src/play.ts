/**
 * The refresher's RECORD OF PLAY (the goal moments, 4a-i): the evidence a
 * full-time toast is said from.
 *
 * Full time is a match the refresher SAW in play (`seen`) that a later whole
 * read returns finished (`finished`, with the time of that read); absence never
 * means full time. Both publishers (`runRefresh`'s bundled lane and the one off
 * the bundle) advance it under the lock on every live read, and carry it on
 * every publish, through one rule:
 *
 *   - a whole read: an id in play is seen (its `at` this read's time, its last
 *     observation in play); a seen id the read returns finished moves to
 *     `finished` (its `at` this read's time); an id already finished keeps its
 *     `at` and takes this read's record; an id in play again leaves `finished`
 *     for `seen`; a seen id the read holds neither in play nor finished is
 *     dropped with nothing said, unless the read's finished list was cut at
 *     its cap (then its absence decides nothing);
 *   - a read that is not whole (failed, degraded, partial): nothing is decided,
 *     the record is kept as it was;
 *   - on any read, expiry: a seen entry 6 hours after its own `at`, a finished
 *     one 10 minutes after its own; an `at` in the future is not believed.
 *
 * Pure and total, like `scheduleSlice.ts`: a function of the previous state
 * (read back from the file, so input: a malformed one is no state), the read
 * and a clock. Each list holds at most {@link MAX_PLAY} entries.
 */
import { type Match, parseCachedMatch, parsedValue, takeBounded, type TeamKind } from '@claudinho/core';
import { validStamp } from './cache';

/** A finished entry lasts this long from the read that first saw it finished. */
export const FINISHED_TTL_MS = 10 * 60_000;
/** A seen entry lasts this long from its last observation in play (the in-play bound the gate uses). */
export const SEEN_TTL_MS = 6 * 60 * 60_000;
/** Each list of the record holds at most this many entries (core's live read returns as many finished ones). */
export const MAX_PLAY = 64;

/** The record of play, as the snapshot stores it (`CacheState.play`). */
export interface PlayState {
  /** The matches seen in play, each with the time it was last seen so (ISO 8601). */
  seen: Array<{ id: string; at: string }>;
  /** The matches seen in play, then read finished: the record of that read, and its time (ISO 8601). */
  finished: Array<{ match: Match; at: string }>;
}

/** What `advancePlay` reads of a live read. */
export interface PlayRead {
  /** The read succeeded, was not degraded, and its answer said it was whole. */
  whole: boolean;
  /** The matches in play. */
  matches: readonly Match[];
  /** The window's finished records that hold a score (core's `getLiveRead`). */
  finished: readonly Match[];
  /** The finished list was cut at its cap: an id absent from it decides nothing. */
  finishedTruncated: boolean;
}

/** A read that decides nothing: the record is only expired. */
export const NO_READ: PlayRead = Object.freeze({ whole: false, matches: [], finished: [], finishedTruncated: false });

/** An id as this record keeps one: a short token (the provider's ids are digits). */
const ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** A stamp believed at `now` within `ttl`: written by this product, not in the future, not expired. */
function believedAt(at: unknown, now: number, ttl: number): at is string {
  if (!validStamp(at)) return false;
  const ms = Date.parse(at);
  return ms <= now && now - ms < ttl;
}

/**
 * The ids the record of play holds, as the hot path asks them (the countdown's
 * due rule, `statusline.ts`): every `seen` id and every `finished` entry's
 * `match.id`, each entry checked by the record's own bounds and nothing more:
 * each list bounded at its first {@link MAX_PLAY} entries before any per-entry
 * work (`takeBounded`), an id of the grammar, a stamp believed at `now` (a
 * `seen` one for {@link SEEN_TTL_MS}, a `finished` one for
 * {@link FINISHED_TTL_MS}, both expired AT the bound; a stamp ahead of the
 * clock is not believed). A finished record is NOT sealed: only its id and
 * its stamp are read (the ambient view seals each once, for its own
 * `finished` list). A value that is not a record holds no id. Never throws.
 */
export function playRecordIds(play: unknown, now: number): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!play || typeof play !== 'object' || Array.isArray(play)) return ids;
  const p = play as { seen?: unknown; finished?: unknown };
  for (const raw of takeBounded<unknown>(p.seen, MAX_PLAY)) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, at } = raw as { id?: unknown; at?: unknown };
    if (typeof id === 'string' && ID.test(id) && believedAt(at, now, SEEN_TTL_MS)) ids.add(id);
  }
  for (const raw of takeBounded<unknown>(p.finished, MAX_PLAY)) {
    if (!raw || typeof raw !== 'object') continue;
    const { match, at } = raw as { match?: unknown; at?: unknown };
    if (!match || typeof match !== 'object' || !believedAt(at, now, FINISHED_TTL_MS)) continue;
    const id = (match as { id?: unknown }).id;
    if (typeof id === 'string' && ID.test(id)) ids.add(id);
  }
  return ids;
}

/**
 * The previous state as it is believed at `now`: bounded before any per-entry
 * work, each entry checked (an id of the grammar, a believed stamp; a finished
 * record sealed by core's cache constructor, status `FT` with a score), the
 * first of two entries with one id kept, the expired ones gone. A value that is
 * not a state is no state.
 */
function believedPlay(prev: unknown, now: number, kind: TeamKind): PlayState {
  const out: PlayState = { seen: [], finished: [] };
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return out;
  const p = prev as { seen?: unknown; finished?: unknown };
  const ids = new Set<string>();
  for (const raw of takeBounded<unknown>(p.seen, MAX_PLAY)) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, at } = raw as { id?: unknown; at?: unknown };
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id) || !believedAt(at, now, SEEN_TTL_MS)) continue;
    ids.add(id);
    out.seen.push({ id, at });
  }
  const done = new Set<string>();
  for (const raw of takeBounded<unknown>(p.finished, MAX_PLAY)) {
    if (!raw || typeof raw !== 'object') continue;
    const { match, at } = raw as { match?: unknown; at?: unknown };
    if (!believedAt(at, now, FINISHED_TTL_MS)) continue;
    const sealed = parsedValue(parseCachedMatch(match, { events: false, teamKind: kind }));
    if (sealed?.status !== 'FT' || !sealed.score || done.has(sealed.id)) continue;
    done.add(sealed.id);
    out.finished.push({ match: sealed, at });
  }
  return out;
}

/**
 * THE rule of the record of play (see the module's header): the previous
 * state (input, believed within bounds), a live read and the time of that read
 * give the next state. `kind` is the competition's written team kind, which a
 * carried finished record is sealed with (absent: `club`, which vouches for
 * no flag). Never throws.
 */
export function advancePlay(prev: unknown, read: PlayRead, now: Date, kind: TeamKind = 'club'): PlayState {
  const nowMs = now.getTime();
  const believed = believedPlay(prev, nowMs, kind);
  if (!read.whole) return believed;
  const at = now.toISOString();

  const inPlay = new Set<string>();
  const seenNow: PlayState['seen'] = [];
  for (const m of read.matches) {
    if (typeof m?.id !== 'string' || inPlay.has(m.id)) continue;
    inPlay.add(m.id);
    seenNow.push({ id: m.id, at });
  }
  const finishedRead = new Map<string, Match>();
  for (const m of read.finished) {
    if (typeof m?.id === 'string' && !finishedRead.has(m.id)) finishedRead.set(m.id, m);
  }

  // Finished entries already held: in play again, they leave (the read's
  // in-play list puts them back in `seen`); read finished again, they keep
  // their time and take the newer record; held by the read neither way, they
  // go unless the cut finished list may hold them.
  const finished: PlayState['finished'] = [];
  const held = new Set<string>();
  for (const e of believed.finished) {
    const id = e.match.id;
    if (inPlay.has(id)) continue;
    const again = finishedRead.get(id);
    if (again) finished.push({ match: again, at: e.at });
    else if (read.finishedTruncated) finished.push(e);
    else continue;
    held.add(id);
  }

  // Seen entries the read no longer has in play: finished (full time), kept
  // (the cut list may hold them), or dropped with nothing said.
  const keptSeen: PlayState['seen'] = [];
  for (const e of believed.seen) {
    if (inPlay.has(e.id) || held.has(e.id)) continue;
    const done = finishedRead.get(e.id);
    if (done) {
      finished.push({ match: done, at });
      held.add(e.id);
    } else if (read.finishedTruncated) {
      keptSeen.push(e);
    }
  }

  // At most `MAX_PLAY` each, the newest kept: the oldest entries are first.
  const seen = [...keptSeen, ...seenNow];
  return {
    seen: seen.length > MAX_PLAY ? seen.slice(seen.length - MAX_PLAY) : seen,
    finished: finished.length > MAX_PLAY ? finished.slice(finished.length - MAX_PLAY) : finished,
  };
}
