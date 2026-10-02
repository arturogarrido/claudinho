/**
 * Local micro-cache shared by the statusline (reader) and the refresher
 * (writer). The statusline hot path only ever READS this file; it must be tiny
 * and fast. Writes are atomic (tmp + rename) so a reader never sees a partial
 * file. A lockfile serializes refreshers to prevent stampedes.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_COMPETITION, type Match, type SeasonInfo } from '@claudinho/core';
import { randomBytes } from 'node:crypto';
import { cacheDir, readSmallFile, writeFileAtomic } from './paths';

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
 */
export const CACHE_VERSION = 3;

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
}

const LOCK_STALE_MS = 60_000;

/**
 * Per-scope cache file. The default scope (espn + the bundled World Cup) keeps
 * the legacy `state.json` name — no migration for the installed base — while
 * any other source/competition gets its own slot, so two sessions with
 * different `CLAUDINHO_COMPETITION` values stop thrashing a single file
 * (previously: ping-ponged full refetches plus a refresher spawn per statusline
 * tick on both sides). The slug is sanitized: the competition comes from an env
 * var and must never influence the path beyond a flat filename.
 */
export function cachePath(source = 'espn', competition = DEFAULT_COMPETITION): string {
  return join(cacheDir(), `state${scopeSuffix(source, competition)}.json`);
}

/**
 * What a scope adds to a cache file's name: nothing for the default scope,
 * `.<source>.<competition>` (sanitized to a flat name) for any other. ONE rule
 * for every per-scope file, so a scope's snapshot and its throttle note cannot
 * be named apart.
 */
function scopeSuffix(source: string, competition: string): string {
  if (source === 'espn' && competition === DEFAULT_COMPETITION) return '';
  return `.${`${source}.${competition}`.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function lockPath(): string {
  return join(cacheDir(), 'refresh.lock');
}

function validStamp(value: unknown): value is string {
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
  for (const key of ['season', 'fixturesSeason'] as const) {
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
export function readState(
  source = 'espn',
  competition = DEFAULT_COMPETITION,
): CacheState | undefined {
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

/** Atomically write the cached state (version-stamped, to its scope's file). */
export function writeState(state: CacheState): void {
  writeFileAtomic(
    cachePath(state.source, state.competition),
    JSON.stringify({ ...state, version: CACHE_VERSION }),
  );
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
// refresh asked the provider that had just said stop. The note is where a
// throttle goes whenever a reader would not find it in the snapshot (the lock
// was taken, the publish was refused, the snapshot cannot be read): a tiny
// file beside the snapshot, written atomically and WITHOUT the lock, read by
// everything that reads a backoff (`ensureBackoffVisible` decides).
// It is never deleted (an expired one is simply not believed, and the next
// writer writes over it), so no cleanup can remove a deadline it did not read.

/** A note is `{"until":"<ISO>"}`: far below this. */
const MAX_NOTE_BYTES = 256;

/** The throttle note of a cache scope: named like its snapshot, by the same rule. */
export function backoffNotePath(source = 'espn', competition = DEFAULT_COMPETITION): string {
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
 */
export function backoffInEffect(
  state: CacheState | undefined,
  source: string,
  competition: string,
  now = Date.now(),
): number | undefined {
  const snapshot = state?.backoffUntil ? believedDeadline(Date.parse(state.backoffUntil), now) : undefined;
  const note = readBackoffNote(source, competition, now);
  if (snapshot === undefined) return note;
  return note === undefined ? snapshot : Math.max(snapshot, note);
}

/**
 * Make a throttle visible: called by every writer of a deadline AFTER its
 * attempt to publish one, whether the publish happened, was refused, or was
 * never tried (the lock was someone else's). If the backoff a reader would
 * find (`backoffInEffect` of the snapshot as it is now, and the note) is not at
 * least as late as `untilMs`, the deadline goes to the note. Returns whether it
 * is now visible: false when `untilMs` itself is not believed, or when the note
 * could not be written or read back (never throws). In whole milliseconds, as
 * a stamp stores it and as `writeBackoffNote` compares.
 *
 * A write that HAPPENED is not one a reader will find: an atomic replacement
 * keeps the mode of the file it replaces, so a snapshot nobody can read stays
 * one, and the deadline published into it is on disk and invisible.
 */
export function ensureBackoffVisible(source: string, competition: string, untilMs: number, now = Date.now()): boolean {
  const own = believedDeadline(Math.floor(untilMs), now);
  if (own === undefined) return false;
  const found = backoffInEffect(readCurrentState(source, competition), source, competition, now);
  if (found !== undefined && found >= own) return true;
  return writeBackoffNote(source, competition, own, now);
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

/** The file is not there (as opposed to there and unreadable). */
function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * Age of the lock in ms, or `undefined` when there is NO lock (the file is
 * gone). Uses the timestamp written *inside* the lock (authoritative —
 * survives copies/touch) and falls back to the file mtime. A lock that is
 * there but cannot be judged is Infinity: stale. "Absent" and "stale" are
 * different answers because `claimLock` must not remove a lock that is absent.
 */
function lockAgeMs(now = Date.now()): number | undefined {
  const lp = lockPath();
  let contents: string;
  try {
    contents = readFileSync(lp, 'utf8');
  } catch (e) {
    return isAbsent(e) ? undefined : Infinity;
  }
  const written = Number.parseInt(contents.split(/\s+/)[1] ?? '', 10);
  // Through the shared guard: a lock written in the future never went stale,
  // so it held the refresher silent forever.
  if (Number.isFinite(written)) return stampAgeMs(new Date(written).toISOString(), now);
  // Lock exists but its content is unparseable — fall back to mtime, THROUGH
  // the same guard. Bypassing it here meant an unreadable lock dated 2099 was
  // permanently fresh and never released: `isLockFresh()` true and
  // `acquireLock()` false, forever. Third time a timestamp fix has missed a
  // sibling, which is why every one of them now routes through `stampAgeMs`.
  try {
    return stampAgeMs(new Date(statSync(lp).mtimeMs).toISOString(), now);
  } catch (e) {
    return isAbsent(e) ? undefined : Infinity;
  }
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

/** The token this process last acquired through the no-argument API. */
let heldToken: LockToken | undefined;

function readLockToken(): string | undefined {
  try {
    return readFileSync(lockPath(), 'utf8').trim();
  } catch {
    return undefined;
  }
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
 */
export function claimLock(now = Date.now()): LockToken | undefined {
  mkdirSync(cacheDir(), { recursive: true });
  const lp = lockPath();
  const token = `${process.pid} ${now} ${randomBytes(6).toString('hex')}`;
  if (writeExclusive(lp, token)) return token;
  const age = lockAgeMs(now);
  // Gone since the create failed: nothing to remove. One more create; if
  // someone else got there first, the lock is theirs.
  if (age === undefined) return writeExclusive(lp, token) ? token : undefined;
  // There, and stale (by written timestamp / mtime): take it over.
  if (age > LOCK_STALE_MS) {
    try {
      rmSync(lp, { force: true });
    } catch {
      return undefined; // lost the race to remove it
    }
    // One retry; if someone else grabbed it first, give up (no recursion loop).
    return writeExclusive(lp, token) ? token : undefined;
  }
  return undefined;
}

/** True while the lock file still carries this token (default: this process's). */
export function holdsLock(token: LockToken | undefined = heldToken): boolean {
  return token !== undefined && readLockToken() === token;
}

/** Acquire the refresh lock for this process (the no-argument API). */
export function acquireLock(now = Date.now()): boolean {
  const token = claimLock(now);
  if (token) heldToken = token;
  return token !== undefined;
}

/** Release the lock — a no-op for anyone but its current holder. */
export function releaseLock(token: LockToken | undefined = heldToken): void {
  if (!holdsLock(token)) return;
  try {
    rmSync(lockPath(), { force: true });
  } catch {
    /* ignore */
  }
  if (token === heldToken) heldToken = undefined;
}

/**
 * Publish a snapshot only while the lock is still ours (audit A10). This is an
 * OWNERSHIP CHECK, not atomic fencing: a takeover that lands between the check
 * and the write still lets a stale owner's snapshot land. It narrows the
 * window a refresher that lost its lease has to overwrite its successor; it
 * does not close it (two steps cannot, and Node offers no portable lock the
 * operating system holds). Stated, with the takeover race in `claimLock`.
 * Returns whether the write happened, which is not whether a reader will find
 * it (a snapshot nobody can read stays one): a writer with a throttle asks
 * `ensureBackoffVisible` afterwards, refused or not.
 */
export function publishState(state: CacheState, token: LockToken | undefined = heldToken): boolean {
  if (!holdsLock(token)) return false;
  writeState(state);
  return true;
}
