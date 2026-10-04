/**
 * Local micro-cache shared by the statusline (reader) and the refresher
 * (writer). The statusline hot path only ever READS this file; it must be tiny
 * and fast. Writes are atomic (tmp + rename) so a reader never sees a partial
 * file. A lockfile serializes refreshers to prevent stampedes.
 */
import { closeSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_COMPETITION, lookAtEntry, type Match, type ScheduleEntry, type SeasonInfo } from '@claudinho/core';
import { randomBytes } from 'node:crypto';
import { cacheDir, lookAtSmallFile, readSmallFile, writeFileAtomic } from './paths';

export { cacheDir } from './paths';

/**
 * Cache schema version, stamped into every write. A file with a different (or
 * absent, i.e. pre-versioning) version is treated as ABSENT: with releases
 * shipping near-daily, an old binary's snapshot must never be blind-cast into a
 * new binary's shape — the refresher simply rebuilds it on the next cycle.
 *
 * 3 (0.11): teams carry the provider's id and the state records its season. A
 * version-2 file (0.10.1) is therefore an EMPTY cache to this binary: the hot
 * path renders as if no file existed — it never fetches — and the refresher
 * writes the new one.
 *
 * 4 (0.11): the `schedule` slice, and off the bundled competition a live stamp
 * that can say "never read". An older binary would poll that scope around the
 * clock from a version-4 file's live slice; it gets an empty cache instead.
 *
 * 5 (0.11): a club carries no flag (a version-4 file holds 🏳️ for every club),
 * and a stage can be `REGULAR`, `LEAGUE`, `PO` or `OTHER`, with the provider's
 * words beside an `OTHER` (a version-4 file holds `FRIENDLY` for every league
 * match, and an older reader would drop the records whose stage it does not
 * know). Rejected whole in both directions, like every bump. The one thing a
 * rejection must NOT discard is a provider throttle: a snapshot's
 * `backoffUntil` is a deadline the provider set, not match data, so it is read
 * whatever the file's version (`backoffInEffect`) and made visible in the note
 * before a snapshot of another version is replaced (`writeState`).
 */
export const CACHE_VERSION = 5;

/** Hard byte ceiling before JSON parsing on the statusline hot path. */
export const MAX_STATE_BYTES = 1024 * 1024;
/** Far above any real live/knockout snapshot, but finite before traversal. */
const MAX_STATE_RECORDS = 1024;

/** The cached snapshot. `live` holds in-progress matches at `updatedAt`. */
export interface CacheState {
  /** Schema version (see {@link CACHE_VERSION}); stamped by writeState. */
  version?: number;
  updatedAt: string; // ISO 8601
  live: Match[];
  degraded: boolean;
  source: string;
  /** Competition slug the live data was fetched for (e.g. "fifa.world"). */
  competition: string;
  /**
   * RESOLVED upcoming knockout fixtures (both nations known), so the hot-path
   * statusline can show a real next-match countdown the static bundle can't
   * provide (its KO slots are placeholders). Refreshed on a SEPARATE, slower
   * cadence than `live` (pairings change only when a match finishes), tracked by
   * `fixturesUpdatedAt`. Absent until the refresher first populates it.
   */
  fixtures?: Match[];
  /** ISO 8601 timestamp of the last successful `fixtures` fetch. */
  fixturesUpdatedAt?: string;
  /**
   * ISO 8601 timestamp of the last fixtures fetch ATTEMPT (success or failure).
   * Throttles failure retries: a failed fetch leaves `fixturesUpdatedAt`
   * untouched (fail-closed), which used to degrade the intended 15-min cadence
   * into a retry every lock cycle (~15s) for the whole outage.
   */
  fixturesAttemptedAt?: string;
  /**
   * ISO 8601: the provider throttled/blocked us (429/403) — no refresh of any
   * kind until this passes. Hammering a block at the live cadence makes it
   * worse; the statusline meanwhile fails closed (stale → countdown/`⚽ —`).
   */
  backoffUntil?: string;
  /**
   * The season the provider reported for the response that last refreshed
   * `live`. Read ONLY by the refresher, to notice a rollover (a response for a
   * different season replaces the state whole). The statusline never decides
   * whether a snapshot is current by season: it cannot know a newer one exists.
   * Sealed by its reader (`sealSeason`), like every `Match` in this file.
   */
  season?: SeasonInfo;
  /**
   * The season of the response that produced `fixtures` — its OWN provenance,
   * stored beside it. It is not derivable from `season`: the live slice
   * refreshes every few seconds and can lose its season (a response that states
   * none) while the fixtures it sits beside are carried for fifteen minutes.
   * Re-deriving it from `season` each cycle is how a carried slice from one
   * edition survived into a snapshot labelled with another.
   */
  fixturesSeason?: SeasonInfo;
  /**
   * The schedule ahead, for a competition the bundle does not describe: what
   * decides when a match can be in play there (see `scheduleSlice.ts`, which
   * holds every rule about it). Never filled on the bundled competition, where
   * the bundled schedule decides. Everything in it but the display records is
   * read through `scheduleView`, never directly (the index, both stamps,
   * `failures`, `complete`, `inPlayUntil`, `probe`, the season); the display
   * records are sealed where they are used, like every cached match
   * (`sealFixtures`).
   */
  schedule?: ScheduleSlice;
}

/** The stored schedule slice. Every field is input when read back: see `scheduleView`. */
export interface ScheduleSlice {
  /** One record per relevant fixture, in kickoff order: all of them, or the slice has no index. */
  index?: ScheduleEntry[];
  /** Full records, for display only (the earliest relevant ones at hand). */
  fixtures?: Match[];
  /** ISO 8601: the last discovery that succeeded. */
  updatedAt?: string;
  /** ISO 8601: the last discovery ATTEMPT, written before its request is made. */
  attemptedAt?: string;
  /** Consecutive failed discoveries. */
  failures?: number;
  /** The season of the response that produced the slice. */
  season?: SeasonInfo;
  /** Whether the answer that produced the index was whole. */
  complete?: boolean;
  /** ISO 8601: a match was seen in play; the gate stays open until then. */
  inPlayUntil?: string;
  /** A discovery failed and no live read has asked since. */
  probe?: boolean;
}

const LOCK_STALE_MS = 60_000;

/**
 * Per-scope cache file. The bundled World Cup's scope (espn + `fifa.world`)
 * keeps the legacy `state.json` name — no migration for the installed base —
 * decided by the competition PASSED, never by an absent argument (every caller
 * states its scope: there is no default competition), while
 * any other source/competition gets its own slot, so two sessions with
 * different `CLAUDINHO_COMPETITION` values stop thrashing a single file
 * (previously: ping-ponged full refetches plus a refresher spawn per statusline
 * tick on both sides). The slug is sanitized: the competition comes from an env
 * var and must never influence the path beyond a flat filename.
 */
export function cachePath(source: string, competition: string): string {
  return join(cacheDir(), `state${scopeSuffix(source, competition)}.json`);
}

/**
 * What a scope adds to a cache file's name: nothing for the bundled World Cup's scope,
 * `.<source>.<competition>` (sanitized to a flat name) for any other. ONE rule
 * for every per-scope file, so a scope's snapshot and its throttle note cannot
 * be named apart.
 */
function scopeSuffix(source: string, competition: string): string {
  if (source === 'espn' && competition === BUNDLE_COMPETITION) return '';
  return `.${`${source}.${competition}`.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function lockPath(): string {
  return join(cacheDir(), 'refresh.lock');
}

/** A stamp exactly as this product writes one: a canonical UTC instant. */
export function validStamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/,
  );
  if (!match) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  return new Date(parsed).toISOString() === canonical;
}

function validScope(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9._-]+$/.test(value)
  );
}

/** Validate only the envelope here; each Match is sealed lazily by its reader. */
function isCacheState(value: unknown): value is CacheState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (s.version !== CACHE_VERSION) return false;
  if (!validStamp(s.updatedAt) || typeof s.degraded !== 'boolean') return false;
  if (!validScope(s.source) || !validScope(s.competition)) return false;
  if (!Array.isArray(s.live) || s.live.length > MAX_STATE_RECORDS) return false;
  if (
    s.fixtures !== undefined &&
    (!Array.isArray(s.fixtures) || s.fixtures.length > MAX_STATE_RECORDS)
  ) {
    return false;
  }
  for (const key of ['season', 'fixturesSeason', 'schedule'] as const) {
    const v = s[key];
    if (v !== undefined && (!v || typeof v !== 'object' || Array.isArray(v))) return false;
  }
  for (const key of [
    'fixturesUpdatedAt',
    'fixturesAttemptedAt',
    'backoffUntil',
  ] as const) {
    if (s[key] !== undefined && !validStamp(s[key])) return false;
  }
  return true;
}

/**
 * Read the cached state for a scope, or undefined if missing/corrupt/
 * version-mismatched (never throws).
 */
export function readState(source: string, competition: string): CacheState | undefined {
  try {
    // One descriptor, a bounded read: the statusline reads this on every prompt.
    const bytes = readSmallFile(cachePath(source, competition), MAX_STATE_BYTES);
    if (!bytes) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return isCacheState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the cache only if it was produced for the *current* source + competition.
 * The per-scope filename already isolates scopes; the embedded-field check stays
 * as defense in depth (e.g. a hand-copied file must still not bleed across).
 */
export function readCurrentState(
  source: string,
  competition: string,
): CacheState | undefined {
  const s = readState(source, competition);
  return s && s.source === source && s.competition === competition ? s : undefined;
}

/**
 * The ENVELOPE of a scope's snapshot file, whatever its format version: the
 * parsed object when it is one and names THIS scope (its `source` and
 * `competition`), else undefined. Read through the one bounded reader. For the
 * one field that outlives a format bump, the provider's throttle deadline:
 * nothing else in a file of another version is read.
 */
function snapshotEnvelope(source: string, competition: string): Record<string, unknown> | undefined {
  try {
    const bytes = readSmallFile(cachePath(source, competition), MAX_STATE_BYTES);
    if (!bytes) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const env = parsed as Record<string, unknown>;
    return env.source === source && env.competition === competition ? env : undefined;
  } catch {
    return undefined;
  }
}

/** An envelope's throttle deadline, if its stamp is one this product writes and it is believed at `now`. */
function envelopeDeadline(env: Record<string, unknown> | undefined, now: number): number | undefined {
  const until = env?.backoffUntil;
  return validStamp(until) ? believedDeadline(Date.parse(until), now) : undefined;
}

/**
 * Atomically write the cached state (version-stamped, to its scope's file).
 * Returns whether the snapshot was written; THROWS when the write itself fails
 * (an atomic write's rename can). A `false` is a write that did not happen,
 * exactly as a throw is, for every caller.
 *
 * Before it REPLACES a snapshot of another format version, the throttle that
 * snapshot carries (if believed at `now`) is put in the scope's note: a reader
 * of that other version rejects the new snapshot whole, and must still find
 * the deadline the provider set (`writeBackoffNote` keeps the later of the
 * note's and this one). When the note cannot be made to hold it (the write
 * failed, or what was written cannot be read back), the older snapshot is NOT
 * replaced: it is the one place that deadline is still kept. A snapshot of
 * this version is not re-noted here: its own writer settled its deadline in
 * the note (`ensureBackoffVisible`).
 *
 * The file this would replace, and what the next reader of each format finds:
 *
 * | the file             | its believed deadline | the note             | written? | this format's reader                      | the other format's reader     |
 * |----------------------|-----------------------|----------------------|----------|-------------------------------------------|-------------------------------|
 * | none                 | -                     | -                    | yes      | the new snapshot                          | rejects it; the note if any   |
 * | this version         | -                     | -                    | yes      | the new snapshot                          | rejects it; the note if any   |
 * | another version      | none                  | -                    | yes      | the new snapshot                          | rejects it: nothing to protect |
 * | another version      | yes                   | written, or as late  | yes      | the new snapshot, and the note            | rejects it; the deadline in the note |
 * | another version      | yes                   | cannot be written    | NO       | rejects the old one; its deadline through `backoffInEffect` (no state read) | its own snapshot, deadline included |
 *
 * `now` is the writer's clock; by default the instant the new snapshot is
 * stamped with (`updatedAt`), else the system's.
 */
export function writeState(state: CacheState, now: number = stampOrNow(state.updatedAt)): boolean {
  const replaced = snapshotEnvelope(state.source, state.competition);
  if (replaced !== undefined && replaced.version !== CACHE_VERSION) {
    const until = envelopeDeadline(replaced, now);
    if (until !== undefined && !writeBackoffNote(state.source, state.competition, until, now)) return false;
  }
  writeFileAtomic(
    cachePath(state.source, state.competition),
    JSON.stringify({ ...state, version: CACHE_VERSION }),
  );
  return true;
}

/** A stamp as epoch ms when it is one this product writes, else the system clock. */
function stampOrNow(stamp: unknown): number {
  return validStamp(stamp) ? Date.parse(stamp) : Date.now();
}

/** Longest a provider backoff may hold, whatever the file claims. */
const MAX_BACKOFF_MS = 30 * 60_000;

/**
 * A backoff deadline as epoch ms, if it is BELIEVED at `now`: in the future
 * and at most `MAX_BACKOFF_MS` ahead. The one rule for every deadline, wherever
 * it is stored and whoever reads or writes it.
 *
 * BOUNDED. `now < t` alone let a `backoffUntil` of 2099 suppress every refresh
 * forever — a permanent silence written by whoever last wrote the file. The
 * real backoff is 5-6 minutes (15 at most, from a Retry-After); anything past
 * the ceiling is not a backoff we wrote. A value that is not believed takes no
 * part in anything: it does not block, it does not beat a real throttle when
 * two are compared, and it does not hide one.
 */
export function believedDeadline(untilMs: number | undefined, now: number): number | undefined {
  if (untilMs === undefined || !Number.isFinite(untilMs)) return undefined;
  return now < untilMs && untilMs - now <= MAX_BACKOFF_MS ? untilMs : undefined;
}

// ---- the throttle note ----
//
// A throttle is written into the snapshot under the refresh lock. A command
// that meets one while a refresher holds that lock (for as long as a request
// can take) could not write it, exited, and the throttle was lost: the next
// refresh asked the provider that had just said stop. The note is where every
// throttle a writer settles goes (`ensureBackoffVisible`): a tiny file beside
// the snapshot, written atomically and WITHOUT the lock, read by everything
// that reads a backoff, and in the same form by every format of the snapshot
// (a reader of another format rejects the snapshot whole, deadline included,
// so the snapshot's own copy is never the only one).
// It is never deleted (an expired one is simply not believed, and the next
// writer writes over it), so no cleanup can remove a deadline it did not read.

/** A note is `{"until":"<ISO>"}`: far below this. */
const MAX_NOTE_BYTES = 256;

/** The throttle note of a cache scope: named like its snapshot, by the same rule. */
export function backoffNotePath(source: string, competition: string): string {
  return join(cacheDir(), `backoff${scopeSuffix(source, competition)}.json`);
}

/** The note's deadline if there is a readable note and it is believed at `now` (never throws). */
export function readBackoffNote(source: string, competition: string, now = Date.now()): number | undefined {
  try {
    const bytes = readSmallFile(backoffNotePath(source, competition), MAX_NOTE_BYTES);
    if (!bytes) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const until = (parsed as { until?: unknown }).until;
    if (!validStamp(until)) return undefined;
    return believedDeadline(Date.parse(until), now);
  } catch {
    return undefined;
  }
}

/**
 * Write a throttle deadline to the scope's note, keeping the LATER of the
 * believed deadline already there and this one. Needs no lock. Returns whether
 * the note now holds a deadline at least as late as `untilMs`, as a READER
 * sees it (false when `untilMs` itself is not believed, when the write failed,
 * or when what was written cannot be read back: never throws). A caller that
 * gets false still has the throttle to place somewhere.
 *
 * Read-then-write is two steps: two writers a few file operations apart can
 * leave the earlier of two real deadlines. Both are throttles the provider
 * sent; the difference is how long they last.
 */
export function writeBackoffNote(source: string, competition: string, untilMs: number, now = Date.now()): boolean {
  // A stamp holds whole milliseconds: compare what will be written, so the
  // read-back below sees the same number.
  const own = believedDeadline(Math.floor(untilMs), now);
  if (own === undefined) return false;
  const stored = readBackoffNote(source, competition, now);
  if (stored !== undefined && stored >= own) return true;
  try {
    writeFileAtomic(backoffNotePath(source, competition), JSON.stringify({ until: new Date(own).toISOString() }));
  } catch {
    return false;
  }
  // Written is not readable: a replacement inherits the mode of the file it
  // replaces, so a note nobody can read stays one. Ask what a reader would.
  const readBack = readBackoffNote(source, competition, now);
  return readBack !== undefined && readBack >= own;
}

/**
 * The backoff in effect for a scope: the later BELIEVED deadline of the
 * snapshot's `backoffUntil` and the scope's note, as epoch ms. Every reader of
 * a backoff asks this: the hot-path triggers, the refresher under its lock, a
 * command arming its adapter; and every writer, to keep the later deadline and
 * to know whether its own is in place. The two are validated separately, so an
 * unbelieved value on one side never hides a believed one on the other.
 *
 * With NO state (none was read: no file, or a file this reader rejected, such
 * as one of another format version), the snapshot FILE's deadline is read
 * whatever its version: the envelope's scope and stamp are checked, the
 * believed-deadline rule is the same, and nothing else in it is read. A
 * throttle the provider set must survive a format bump. The cost on the hot
 * path: one more bounded read of the small snapshot file, only when the
 * snapshot was rejected or absent (state undefined), never when it was read.
 */
export function backoffInEffect(
  state: CacheState | undefined,
  source: string,
  competition: string,
  now = Date.now(),
): number | undefined {
  const snapshot =
    state === undefined
      ? envelopeDeadline(snapshotEnvelope(source, competition), now)
      : state.backoffUntil
        ? believedDeadline(Date.parse(state.backoffUntil), now)
        : undefined;
  const note = readBackoffNote(source, competition, now);
  if (snapshot === undefined) return note;
  return note === undefined ? snapshot : Math.max(snapshot, note);
}

/**
 * Make a throttle visible: called by every writer of a deadline AFTER its
 * attempt to publish one, whether the publish happened, was refused, failed
 * (it threw), or was never tried (the lock was someone else's). The deadline
 * goes to the NOTE unless the note already holds one at least as late
 * (`writeBackoffNote` keeps the later). The snapshot's own copy does not count
 * as visible: a reader of another format rejects this snapshot whole, and
 * finds the deadline only in the note, whose form every format shares (the
 * same reason `writeState` notes the deadline of a snapshot of another format
 * before replacing it). Returns whether the note now holds it: false when
 * `untilMs` itself is not believed, or when the note could not be written or
 * read back (never throws). In whole milliseconds, as a stamp stores it.
 *
 * The cost: one small atomic write per throttle a writer settles (a
 * refresher's cycle that met one, a command that met one), never per cycle: a
 * deadline the note already holds is only read. A write that HAPPENED to the
 * snapshot is not one every reader will find either: an atomic replacement
 * keeps the mode of the file it replaces, so a snapshot nobody can read stays
 * one, and the deadline published into it is on disk and invisible.
 */
export function ensureBackoffVisible(source: string, competition: string, untilMs: number, now = Date.now()): boolean {
  return writeBackoffNote(source, competition, untilMs, now);
}

// ---- the attempt record ----
//
// A snapshot whose FILE exists but cannot be read (mode 000) looks like "no
// snapshot" to every reader, and the refresher's atomic replacement keeps the
// mode of the file it replaces, so what it publishes stays unreadable: every
// statusline tick started a refresher, and inside a live window every one of
// them asked the provider (0.11, ledger row D8). An ATTEMPT is therefore
// recorded where a reader finds it without the snapshot: a tiny file beside
// the throttle note (`attempt<scope>.json`, `{"at":"<ISO>","count":n}`), named
// by the same scope rule, written atomically under the refresh lock and never
// deleted. Beside the note because it answers the same kind of question ("may
// the provider be asked now?") for a reader that has no snapshot, in a form
// every format of the snapshot shares.
//
// It is read ONLY when no snapshot could be read (the hot path's no-snapshot
// branch, a refresher cycle whose base read is undefined): a readable snapshot
// pays nothing, an old record on disk or not. Such a cycle records its attempt
// first, under the lock, before any publish or request: `{ at: now, count:
// previous + 1 }`, read back through the bounded reader (as `writeBackoffNote`
// tells written from visible). The gate FAILS CLOSED ONLY WHERE A PUBLISH
// COULD NOT HEAL. A publish is an atomic write, a temporary file renamed over
// the snapshot's path: the replacement is ours and keeps the mode bits of
// whatever it replaces but a link, and nothing else of it (no access-control
// entry, no other owner). So a publish heals what the rename replaces with a
// file this process can read, and only two states survive it
// (`snapshotUnhealable`): a directory (the rename cannot replace it) and an
// entry that is not a link whose own mode denies its owner a read (the
// owner-read bit clear, mode 000, 200 or 044, whatever the kind: a regular
// file, refused or opened through its other bits or an access-control entry;
// a pipe; a socket). There the attempt is admitted only when what is read
// back is what was written, else nothing is done. Everywhere else a publish
// heals in one cycle, so the cycle goes on whether or not its attempt could be
// recorded: no entry; a symbolic link to anything (nothing of it is kept); and
// any other entry whose owner-read bit is set: a pipe or a socket (replaced by
// a file of ours with those bits), a cache file refused (an access-control
// list, another owner's 0600), and a cache file this reader opened and
// rejected (bad JSON, another format version, larger than the reader's bound,
// another scope's). A believed record that is not due stops the cycle in every
// case.
// When the cycle's snapshot then reads back usable, the record is settled to
// `count: 0`. `count` is "admissions since the last persisted reset": a
// conservative pacing state, not a history.
//
// BELIEVED when the file parses to an object whose `at` is a stamp this product
// writes (`validStamp`) at most `FUTURE_SKEW_MS` ahead (the snapshot's rule);
// a `count` that is not a non-negative safe integer reads as 0, the stamp kept.
// NO age bound: a record of any age is believed and, past its delay, due, and
// its count is carried into the next admission, so an incident inherits the
// count of the one before it when no readable snapshot reset it in between
// (its first attempt is immediate only when the retained record is due). The
// alternative, a reset by age, let a late retry at the cap restart the ramp.
// The pace: one minute, doubling per admission, at most thirty
// (`attemptDelayMs`). The throttle is independent of it and settled as before.
//
// STATED LIMIT: with a directory, or an entry that is not a link whose own mode
// denies its owner a read, at the snapshot's path, a record nobody can read
// (its own mode 000, a directory at its path) admits nothing. The provider is then not asked and nothing is
// published, but the hot path, which cannot read the record either, still
// starts a refresher on every tick. So does a cache directory whose new files
// nobody can read (an inherited deny-read ACL): no cycle asks or publishes (the
// lock cannot be read back by its claimer, so `claimLock` claims nothing); the
// spawn per tick stays. In every other state the cycle proceeds as it did
// before this record existed, and its publish ends the loop.

/** A record is `{"at":"<ISO>","count":n}`: far below this (the note's bound). */
const MAX_ATTEMPT_BYTES = MAX_NOTE_BYTES;

/** The first delay after an admission, and the ceiling (the one `believedDeadline` uses). */
const ATTEMPT_BASE_MS = 60_000;
const ATTEMPT_MAX_MS = MAX_BACKOFF_MS;
/** The count past which the delay no longer doubles: 2^(6-1) minutes is past the ceiling. */
const ATTEMPT_DOUBLINGS = 6;

/** A believed attempt record: when the last attempt was admitted (epoch ms), and the count since the last reset. */
export interface AttemptRecord {
  at: number;
  count: number;
}

/** The attempt record of a cache scope: named like its snapshot and its note, by the same rule. */
export function attemptRecordPath(source: string, competition: string): string {
  return join(cacheDir(), `attempt${scopeSuffix(source, competition)}.json`);
}

/** The scope's attempt record if there is a readable one and it is believed at `now` (never throws). */
export function readAttemptRecord(source: string, competition: string, now: number): AttemptRecord | undefined {
  try {
    const bytes = readSmallFile(attemptRecordPath(source, competition), MAX_ATTEMPT_BYTES);
    if (!bytes) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const { at, count } = parsed as { at?: unknown; count?: unknown };
    if (!validStamp(at)) return undefined;
    const atMs = Date.parse(at);
    // A stamp in the future beyond the tolerated skew is wrong, not recent.
    if (atMs - now > FUTURE_SKEW_MS) return undefined;
    const believedCount = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0;
    return { at: atMs, count: believedCount };
  } catch {
    return undefined;
  }
}

/** How long after an admission the next one is due: 0 for a count of 0; else 1, 2, 4, 8, 16, 30, 30… minutes. */
export function attemptDelayMs(count: number): number {
  if (!(count > 0)) return 0;
  return Math.min(ATTEMPT_BASE_MS * 2 ** (Math.min(count, ATTEMPT_DOUBLINGS) - 1), ATTEMPT_MAX_MS);
}

/** Whether an attempt may be admitted at `now`: no believed record, a count of 0, or its delay elapsed. */
export function attemptDue(record: AttemptRecord | undefined, now: number): boolean {
  if (record === undefined) return true;
  const delay = attemptDelayMs(record.count);
  return delay === 0 || now - record.at >= delay;
}

/**
 * Write `{ at: now, count }` to the scope's record and ask what a reader would:
 * true only when the record read back is exactly the one written. Never throws.
 */
function writeAttemptRecord(source: string, competition: string, now: number, count: number): boolean {
  try {
    const stamp = new Date(now).toISOString();
    writeFileAtomic(attemptRecordPath(source, competition), JSON.stringify({ at: stamp, count }));
    // Written is not readable: a replacement inherits the mode of the file it
    // replaces, so a record nobody can read stays one.
    const readBack = readAttemptRecord(source, competition, now);
    return readBack !== undefined && readBack.at === Date.parse(stamp) && readBack.count === count;
  } catch {
    return false;
  }
}

/**
 * ADMIT an attempt at `now`, under the refresh lock, before anything is
 * published or asked: write `{ at: now, count: believed count + 1 }` and read
 * it back. Returns the count when the record read back is the one written,
 * else undefined (the write failed, or what was written cannot be read). What
 * the caller then does depends on the snapshot file (the refresher's
 * `admitNoBaseCycle`): a directory, or an entry that is not a link whose own
 * mode denies its owner a read, nothing; otherwise the cycle goes on. The
 * carried count is clamped so the sum stays a safe integer (any count from 6 on waits the ceiling; above that
 * it is only a count). Never throws.
 */
export function admitAttempt(source: string, competition: string, now: number): number | undefined {
  try {
    const previous = readAttemptRecord(source, competition, now)?.count ?? 0;
    const count = Math.min(previous, Number.MAX_SAFE_INTEGER - 1) + 1;
    return writeAttemptRecord(source, competition, now, count) ? count : undefined;
  } catch {
    return undefined;
  }
}

/**
 * SETTLE the record after a cycle whose snapshot reads back usable: write
 * `{ at: now, count: 0 }` and return whether it reads back as that. A reset
 * that fails or is not visible leaves the admission record, unread while the
 * snapshot is usable. Never throws.
 */
export function settleAttempt(source: string, competition: string, now: number): boolean {
  return writeAttemptRecord(source, competition, now, 0);
}

/**
 * Whether a publish could NOT heal what is at the scope's snapshot path. A
 * publish (an atomic write) heals what its rename replaces with a file this
 * process can read: the replacement is ours and keeps the mode bits of
 * whatever it replaces but a link, and nothing else of it (no access-control
 * entry, no other owner). So: true for a directory (the rename cannot replace
 * it), an entry that is not a link whose own mode denies its owner a read (the
 * owner-read bit clear, whatever the kind: a regular file, refused or opened
 * through its other bits or an access-control entry; a pipe; a socket: the
 * replacement keeps the bits, so stays unreadable), and an entry nobody can
 * look at (the directory above it cannot be searched). One look at the entry
 * through core's `lookAtEntry` (`lstat`, never following a link; the
 * owner-read bit asked before any open; an open only for a regular file;
 * nothing read). False for everything a publish heals: no entry, a symbolic
 * link to anything (nothing of it is kept), and any other entry whose
 * owner-read bit is set: a pipe or a socket, a cache file refused (an
 * access-control list, another owner's 0600), and a cache file that opens,
 * whatever this reader made of its content (bad JSON, another format version,
 * larger than `MAX_STATE_BYTES`, another scope's).
 * Asked by the refresher on a cycle whose base read is undefined: it is where
 * the gate fails closed (`admitNoBaseCycle`). (The bounded reader's own kinds
 * cannot ask it: `lookAtSmallFile` answers `unreadable` alike for a file it
 * cannot open, one over its bound, and a link to nothing.) Never throws.
 */
export function snapshotUnhealable(source: string, competition: string): boolean {
  return lookAtEntry(cachePath(source, competition)) === 'unhealable';
}

/** Age of the latest fixtures ATTEMPT in ms (Infinity if never attempted). */
export function fixturesAttemptAgeMs(
  state: CacheState | undefined,
  now = Date.now(),
): number {
  return stampAgeMs(state?.fixturesAttemptedAt, now);
}

/** Age of the cache in ms (Infinity if absent/unparseable). */
/** Tolerated clock skew between writing a snapshot and reading it back. */
const FUTURE_SKEW_MS = 60_000;

/**
 * How old a cache timestamp is, or Infinity if we cannot trust it.
 *
 * A stamp in the FUTURE is not fresh, it is wrong. Returned as a negative age
 * it compares below every staleness threshold, so a value dated 2099 reads as
 * current forever and no refresh supersedes it — fail-OPEN on exactly the
 * fields that decide whether we trust the file. Ordinary skew between writing
 * and reading is tolerated; a meaningful lead is not.
 *
 * EVERY age question goes through here. Fixing only `updatedAt` left the
 * siblings — the fixtures attempt stamp, the market entries — open to the same
 * value, which is the "fixed one instance, not the class" mistake again.
 */
export function stampAgeMs(value: string | undefined, now: number): number {
  if (!value) return Infinity;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return Infinity;
  const age = now - t;
  return age < -FUTURE_SKEW_MS ? Infinity : age;
}

export function ageMs(state: CacheState | undefined, now = Date.now()): number {
  return stampAgeMs(state?.updatedAt, now);
}

/**
 * Age of the cached knockout `fixtures` in ms (Infinity if never fetched). Its
 * own clock — `fixtures` refreshes on a slower cadence than `live`, so a fresh
 * live write must not make stale fixtures look fresh (or vice-versa).
 */
export function fixturesAgeMs(state: CacheState | undefined, now = Date.now()): number {
  return stampAgeMs(state?.fixturesUpdatedAt, now);
}

/**
 * A lock is `<pid> <stamp> <nonce>` (a few dozen bytes): far below this. It is
 * read on every prompt (`isLockFresh`), through the one reader of kept files.
 */
const MAX_LOCK_BYTES = 256;

/** The age of an epoch-ms instant, through `stampAgeMs`; Infinity if it is no instant at all. */
function epochAgeMs(ms: number, now: number): number {
  const at = new Date(ms);
  // Beyond the range of a date: further from now than any stamp can be, so
  // stale, like a stamp in the future. (`toISOString` would throw.)
  return Number.isNaN(at.getTime()) ? Infinity : stampAgeMs(at.toISOString(), now);
}

/**
 * Age of the lock in ms, or `undefined` when there is NO lock. Read through ONE
 * descriptor, without waiting: the hot path asks this on every prompt, and a
 * pipe at the lock's path used to block it for ever. What each answer of the
 * reader (`lookAtSmallFile`) means for a lock:
 * - `absent` (no entry) → `undefined`: `claimLock` creates, it never removes
 *   what is not there;
 * - `unreadable` (a pipe, a device, a directory, a link to nothing, no
 *   permission, larger than `MAX_LOCK_BYTES`) → Infinity: there, and nobody can
 *   judge it, so stale, and `claimLock` takes it over (a directory cannot be
 *   removed, so nobody takes that one: stated);
 * - `grown` (being written while it was read: an owner writes its token just
 *   after creating the lock) → the age of its mtime: a lock written now is
 *   fresh. Taking it for stale had a contender remove a lock a moment old;
 * - `read` → the timestamp written *inside* the lock (authoritative — survives
 *   copies/touch), else the mtime of the same open file (an empty lock, its
 *   token not yet written, is judged by its date too).
 *
 * Intended change (0.11 2.6a): a junk lock LARGER than the bound used to be
 * read whole and judged by its mtime (fresh for a minute after it was
 * written); it is now unreadable, so stale, and taken over.
 */
function lockAgeMs(now = Date.now()): number | undefined {
  const lock = lookAtSmallFile(lockPath(), MAX_LOCK_BYTES);
  if (lock.kind === 'absent') return undefined;
  if (lock.kind === 'unreadable') return Infinity;
  if (lock.kind === 'grown') return epochAgeMs(lock.mtimeMs, now);
  const written = Number.parseInt(lock.bytes.toString('utf8').split(/\s+/)[1] ?? '', 10);
  // Through the shared guard: a lock written in the future never went stale,
  // so it held the refresher silent forever.
  if (Number.isFinite(written)) return epochAgeMs(written, now);
  // Lock exists but its content is unparseable — fall back to mtime, THROUGH
  // the same guard. Bypassing it here meant an unreadable lock dated 2099 was
  // permanently fresh and never released: `isLockFresh()` true and
  // `claimLock()` undefined, forever. Third time a timestamp fix has missed a
  // sibling, which is why every one of them now routes through `stampAgeMs`.
  return epochAgeMs(lock.mtimeMs, now);
}

/** True if a refresher currently holds a non-stale lock. */
export function isLockFresh(now = Date.now()): boolean {
  const age = lockAgeMs(now);
  return age !== undefined && age < LOCK_STALE_MS;
}

/**
 * The lock's owner token: `<pid> <stamp> <nonce>`. The stamp stays the second
 * field so `lockAgeMs` keeps reading it; the nonce makes the token unguessable
 * so ownership cannot be spoofed by pid reuse.
 */
export type LockToken = string;

/** The token in the lock file, read like its age (one descriptor, bounded, never waits). */
function readLockToken(): string | undefined {
  return readSmallFile(lockPath(), MAX_LOCK_BYTES)?.toString('utf8').trim();
}

function writeExclusive(lp: string, token: LockToken): boolean {
  try {
    const fd = openSync(lp, 'wx'); // O_CREAT | O_EXCL
    try {
      writeSync(fd, token);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim the refresh lock (atomic O_EXCL), taking over a stale one. Returns the
 * owner token, which `holdsLock`, `publishState` and `releaseLock` require —
 * audit A10: a release without ownership used to unlink whatever lock was
 * there, so a stale owner waking up removed its SUCCESSOR's lock and a third
 * refresher was admitted while the successor still ran.
 *
 * A lock that is GONE when it is looked at (its owner released it, normally,
 * just after this claimer's create failed) is not removed: it used to count
 * as stale, and "remove it, create mine" removed whatever lock a third
 * refresher had created in that instant, so two held it with no dead or hung
 * owner anywhere. The claimer tries the exclusive create once more instead.
 *
 * NOT CLOSED (stated, 0.11 2.6a): taking over a lock that IS stale is "judge
 * it stale, remove it, create mine" — three steps. Between the judgment and the
 * removal the lock can be replaced (by another stealer of the same stale lock,
 * or by a fresh claimer once the stale owner woke and released), and the
 * removal then takes the new one: two can hold the lock, and several delayed
 * stealers can remove successive owners. It takes a refresher that died or
 * hung for more than `LOCK_STALE_MS` AND processes inside the same few file
 * operations; each extra holder is one overlapping cycle of requests, and its
 * publish is refused by the ownership check unless it lands inside that
 * check's own window (check, then write: see `publishState`). A single stealer
 * is enough to take the lease of an owner that still runs (a suspended
 * machine, a clock that stepped, a caller that judges with a clock more than
 * `LOCK_STALE_MS` behind the lock's stamp): that owner's publish is then
 * refused, and a throttle it met goes to the note. Closing it takes lock names
 * that are never reused (a generation per acquisition); a rename-and-restore
 * takeover was designed and withdrawn, because it opens the lock path to a
 * third process while it runs.
 *
 * A claim the claimer cannot read back is no claim (0.11, the cleanup PR).
 * After every exclusive create that succeeded (the first, the one after the
 * lock was found gone, the one after a stale lock was removed) the token is
 * READ BACK through the reader `holdsLock` uses, and a read that is not the
 * token written (nothing read, or another's token) returns `undefined`. Every
 * use of a token asks `holdsLock` (a publish, a release, the attempt record's
 * settlement), so a token that fails it at the instant of its claim serves
 * nothing: in a cache directory whose new files nobody can read (an inherited
 * deny-read ACL) the lock is created and written and cannot be read back, and
 * a cycle holding it asked the provider, on every tick, for an answer it could
 * never publish. The entry is LEFT where it is: the read-back is the ownership
 * check and it failed, so removing it would be the unguarded unlink audit A10
 * closed (in the takeover race above, it can already be a successor's). The
 * next claimer judges what it finds: unreadable, so stale, taken over, and
 * refused again on its own read-back; once reads work again, an ordinary lock
 * stamped by its last claimer, fresh for the lease and stale after it, like a
 * refresher that died holding it. Every caller treats `undefined` as a lock
 * held by another: nothing asked, nothing published, and a command's throttle
 * goes to the note.
 */
export function claimLock(now = Date.now()): LockToken | undefined {
  mkdirSync(cacheDir(), { recursive: true });
  const lp = lockPath();
  const token = `${process.pid} ${now} ${randomBytes(6).toString('hex')}`;
  /** After a create that succeeded: ours only when the token reads back as written (never removed otherwise). */
  const readBack = (): LockToken | undefined => (readLockToken() === token ? token : undefined);
  if (writeExclusive(lp, token)) return readBack();
  const age = lockAgeMs(now);
  // Gone since the create failed: nothing to remove. One more create; if
  // someone else got there first, the lock is theirs.
  if (age === undefined) return writeExclusive(lp, token) ? readBack() : undefined;
  // There, and stale (by written timestamp / mtime): take it over.
  if (age > LOCK_STALE_MS) {
    try {
      rmSync(lp, { force: true });
    } catch {
      return undefined; // lost the race to remove it
    }
    // One retry; if someone else grabbed it first, give up (no recursion loop).
    return writeExclusive(lp, token) ? readBack() : undefined;
  }
  return undefined;
}

/**
 * True while the lock file still carries this token. The token is REQUIRED
 * (0.11, ledger row D3): the lock API has one form, the token `claimLock`
 * returned. There is no "this process's lock" kept in a module variable; an
 * `undefined` token (a claim that failed) holds nothing. `claimLock` already
 * asked this once, at the instant of the claim: a token it returned read back.
 */
export function holdsLock(token: LockToken | undefined): boolean {
  return token !== undefined && readLockToken() === token;
}

/** Release the lock — a no-op for anyone but its current holder (the token is required). */
export function releaseLock(token: LockToken | undefined): void {
  if (!holdsLock(token)) return;
  try {
    rmSync(lockPath(), { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Publish a snapshot only while the lock is still ours (audit A10). This is an
 * OWNERSHIP CHECK, not atomic fencing: a takeover that lands between the check
 * and the write still lets a stale owner's snapshot land. It narrows the
 * window a refresher that lost its lease has to overwrite its successor; it
 * does not close it (two steps cannot, and Node offers no portable lock the
 * operating system holds). Stated, with the takeover race in `claimLock`.
 * Returns whether the write happened (`false`: the lock is not ours, or
 * `writeState` refused to replace an older snapshot whose throttle could not
 * be noted), which is not whether a reader will find it (a snapshot nobody can
 * read stays one): a writer with a throttle asks `ensureBackoffVisible`
 * afterwards, refused or not. It THROWS when the write fails (an atomic
 * write's rename can): every writer catches that as a publish that did not
 * happen, like a `false`, and a writer with a throttle still asks.
 */
export function publishState(
  state: CacheState,
  /** The owner token `claimLock` returned: required, like `holdsLock`'s. */
  token: LockToken | undefined,
  /** The writer's clock (see `writeState`); by default the snapshot's own stamp. */
  now?: number,
): boolean {
  return holdsLock(token) && writeState(state, now);
}
