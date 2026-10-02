/**
 * Cache refresher — the COLD PATH. Runs as a detached child spawned by the
 * statusline (or as a standalone). Acquires a lock, fetches live state only
 * during a live window, and atomically writes the cache. Network happens here
 * and only here, never on the statusline hot path.
 */
import { spawn } from 'node:child_process';
import {
  allFixtures,
  bundleApplies,
  isUpcoming,
  byKickoff,
  getKnockoutFixtures,
  getLiveMatches,
  getLiveRead,
  getScheduleAhead,
  KNOWN_SOURCES,
  makeAdapter,
  sealSeason,
  type Match,
  type ProviderAdapter,
  type SeasonInfo,
} from '@claudinho/core';
import {
  ageMs,
  backoffInEffect,
  type CacheState,
  fixturesAgeMs,
  fixturesAttemptAgeMs,
  isLockFresh,
  readState,
  releaseLock,
  claimLock,
  publishState,
  stampAgeMs,
  writeBackoffNote,
} from './cache';
import {
  applyDiscovery,
  discoveryDue,
  raiseInPlay,
  scheduleGateOpen,
  type ScheduleView,
  scheduleView,
} from './scheduleSlice';
import { inLiveWindow, LIVE_TTL_MS, sealFixtures } from './statusline';

/** Don't re-fetch if the cache is younger than this (anti-stampede). */
const MIN_REFRESH_MS = 12_000;

/**
 * Knockout pairings change only when a match finishes, so the cached resolved
 * `fixtures` refresh on a much slower cadence than live scores — a few-minute lag
 * on a multi-day countdown is invisible, and this bounds the off-live-window
 * polling the statusline triggers to ~4 fetches/hour.
 */
const FIXTURES_TTL_MS = 15 * 60_000;

/**
 * BUT a successful fetch that returns ZERO resolved fixtures (ESPN hasn't filed
 * the pairings yet — the phase boundary, or the first poll as knockouts lock in)
 * must NOT suppress re-polling for the full 15min, or the statusline sits on
 * "⚽ —" long after the pairings appear. So an empty result is trusted only
 * briefly. (A provider ERROR is different — handled fail-closed by keeping the
 * prior cache; this is about a real-but-empty success.)
 */
const FIXTURES_EMPTY_TTL_MS = 60_000;

/**
 * How long the provider is left alone after it throttles/blocks us (429/403),
 * plus up to a minute of jitter so a fleet of statuslines doesn't retry in
 * lockstep. Persisted as `backoffUntil` and honored by every refresh trigger.
 */
const BACKOFF_MS = 5 * 60_000;
const BACKOFF_JITTER_MS = 60_000;

/**
 * Whether the cached knockout `fixtures` are stale enough to refetch. Uses the
 * short empty-TTL when the cache holds no resolved fixtures (re-poll soon at the
 * boundary), the long TTL once it holds some (pairings are stable). A recent
 * ATTEMPT also suppresses a refetch: a FAILED fetch keeps `fixturesUpdatedAt`
 * untouched (fail-closed), which used to collapse the cadence into a retry
 * every lock cycle (~15s) for the whole outage — now failures re-poll on the
 * same short cadence as an empty result.
 */
function fixturesStale(state: CacheState | undefined, now: number): boolean {
  const ttl = (state?.fixtures?.length ?? 0) > 0 ? FIXTURES_TTL_MS : FIXTURES_EMPTY_TTL_MS;
  if (fixturesAgeMs(state, now) <= ttl) return false; // `>` boundary matches shouldRefresh's LIVE_TTL
  return fixturesAttemptAgeMs(state, now) > FIXTURES_EMPTY_TTL_MS;
}

/** The soonest upcoming static fixture (cheap; bundle is in memory). */
function nextStaticUpcoming(nowMs: number): Match | undefined {
  return [...allFixtures()].sort(byKickoff).find((m) => isUpcoming(m, new Date(nowMs)));
}

/**
 * We're in the knockout phase (and on the bundled competition, the only one
 * with a bundled bracket) when the next upcoming fixture is a knockout — that's
 * exactly when the statusline needs live-resolved pairings the bundle lacks.
 */
export function inKnockoutPhase(nowMs: number, competition: string): boolean {
  if (!bundleApplies(competition)) return false;
  const next = nextStaticUpcoming(nowMs);
  return !!next && next.stage !== 'GROUP' && next.stage !== 'FRIENDLY';
}

/**
 * The stamp of a live slice that was never read. Off the bundle the first
 * snapshot can be written by a cycle that only discovered: its live slice says
 * "nothing in play" without anyone having asked, so its stamp must never look
 * fresh (the statusline would trust it for five minutes, and a probe that is
 * owed would be skipped as already answered).
 */
const NEVER = new Date(0).toISOString();

/** A stamp carried from the cache file, re-emitted in one form; nothing if it cannot be trusted. */
function carriedStamp(value: string | undefined, now: number): string | undefined {
  return value !== undefined && Number.isFinite(stampAgeMs(value, now))
    ? new Date(Date.parse(value)).toISOString()
    : undefined;
}

/**
 * The live-fetch adapter for a VALIDATED source and the refresh's competition.
 * ONE constructor for every competition: the statusline never renders group
 * letters, so the standings request that enriches them is skipped everywhere.
 * It used to be skipped on the default path only — off-default each poll made
 * TWO requests, on the path that then polled around the clock (the bundle
 * cannot describe another competition's windows; since 0.11 that competition's
 * own discovered schedule does, see `refreshOffBundle`). Never constructs a provider
 * under a label it doesn't match: runRefresh validates `source` against
 * KNOWN_SOURCES before calling this (makeAdapter throws as defense in depth).
 */
function liveAdapter(source: string, competition: string, now?: () => number): ProviderAdapter {
  return makeAdapter(source, { competition, enrichGroups: false, now });
}

export interface RefreshOpts {
  source?: string;
  /**
   * The competition to refresh. Required: the refresher is told (by the
   * config of the process that runs it), it never resolves one itself.
   */
  competition: string;
  now?: Date;
  /** Backoff jitter in ms (tests inject 0). Default: random up to BACKOFF_JITTER_MS. */
  jitterMs?: number;
}

/** Perform one refresh cycle (idempotent, lock-guarded). */
export async function runRefresh(opts: RefreshOpts): Promise<void> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const source = opts.source ?? 'espn';
  const competition = opts.competition;

  // ARCH-10 applies to the refresher too, not just interactive precheck: an
  // unknown source must never poll a provider it doesn't name (the cache scope
  // would be LABELED with the fake source while carrying ESPN data — review P2
  // on PR #78). Fail closed: write ONE idle DEGRADED snapshot so the
  // statusline's no-cache spawn trigger goes quiet, and never touch the
  // network. Interactive commands error loudly for the same config.
  if (!(KNOWN_SOURCES as readonly string[]).includes(source)) {
    if (!readState(source, competition)) {
      const idle = claimLock();
      if (idle) {
        try {
          // Under the lock, and only if nobody wrote one in the meantime (the
          // same rule as the idle snapshot below).
          if (!readState(source, competition)) {
            publishState(
              {
                updatedAt: now.toISOString(),
                live: [],
                degraded: true, // no live provider served this scope — never claim otherwise
                source,
                competition,
              },
              idle,
            );
          }
        } finally {
          releaseLock(idle);
        }
      }
    }
    return;
  }

  /**
   * The scope's snapshot, read NOW. A snapshot from a different
   * source/competition can't be reused — start fresh (and refetch both parts)
   * so e.g. a friendlies cache never bleeds into the WC. (The per-scope cache
   * file already isolates this; defense in depth.)
   */
  const readBase = (): CacheState | undefined => {
    const cached = readState(source, competition);
    return cached && cached.source === source && cached.competition === competition
      ? cached
      : undefined;
  };
  /**
   * Nothing to fetch — but make sure a scope-stamped snapshot EXISTS. The
   * statusline spawns a refresher whenever it finds no cache, so a missing
   * file outside every window (post-tournament, off-hours, fresh installs)
   * would otherwise fork a do-nothing child on EVERY statusline tick, forever
   * (the post-final spawn loop — F5 review PERF-1). `live: []` is honest by
   * construction here: on the bundled competition the bundled schedule says no
   * match can be in play, and off it a missing snapshot always has a discovery
   * due — unless what stopped us is a backoff, and then the snapshot says so
   * (degraded, with the deadline). Written under the lock, and only if nobody
   * wrote one in the meantime.
   */
  const writeIdleSnapshot = (): void => {
    const idle = claimLock();
    if (!idle) return;
    try {
      if (readBase()) return;
      const until = backoffInEffect(undefined, source, competition, nowMs);
      publishState(
        {
          updatedAt: now.toISOString(),
          live: [],
          degraded: until !== undefined,
          source,
          competition,
          ...(until !== undefined ? { backoffUntil: new Date(until).toISOString() } : {}),
        },
        idle,
      );
    } finally {
      releaseLock(idle);
    }
  };

  // Off the bundled competition the bundled schedule says nothing: the cycle is
  // discovery, then a live read only when a match can be in play.
  if (!bundleApplies(competition)) {
    await refreshOffBundle({ now, source, competition, readBase, writeIdleSnapshot, jitterMs: opts.jitterMs });
    return;
  }

  /**
   * What a snapshot says is due.
   *
   * While a provider backoff (429/403) is in effect, NOTHING — retrying a
   * block at the live cadence makes it worse. The statusline fails closed
   * meanwhile (stale snapshot → countdown / `⚽ —`, never a wrong score). The
   * backoff is the later of the snapshot's and the scope's note (a throttle a
   * command met while a refresher held the lock).
   *
   * Two INDEPENDENT cadences: live scores (~12s, only in a live window) and
   * resolved knockout fixtures (~15min, only in the knockout phase). Each part
   * skips if its own slice is still fresh — a live write must not block a due
   * fixtures fetch, or vice-versa.
   */
  const plan = (snapshot: CacheState | undefined) => {
    const inBackoff = backoffInEffect(snapshot, source, competition, nowMs) !== undefined;
    return {
      needLive:
        !inBackoff &&
        inLiveWindow(nowMs) &&
        (!snapshot || ageMs(snapshot, nowMs) >= MIN_REFRESH_MS),
      needFixtures:
        !inBackoff && inKnockoutPhase(nowMs, competition) && fixturesStale(snapshot, nowMs),
    };
  };

  // A first look, WITHOUT the lock. It may only decide not to ask: a snapshot
  // gets fresher, never staler, so "nothing is due" cannot be wrong for long.
  // A decision TO ask is never made here (see below).
  const first = readBase();
  const early = plan(first);
  if (!early.needLive && !early.needFixtures) {
    if (!first) writeIdleSnapshot();
    return;
  }

  const token = claimLock();
  if (!token) return;
  try {
    // THE decision, from the state as it is now that the lock is ours. The
    // first look ran before the lock: between the two, another refresher can
    // have published a fresh slice, or a backoff, and released. Acting on the
    // first look fetched again inside the cadence, right after being told to
    // stop.
    const base = readBase();
    const { needLive, needFixtures } = plan(base);
    if (!needLive && !needFixtures) return;

    // Carry the slice we're NOT refreshing this cycle so a fixtures-only refresh
    // doesn't drop live (and vice-versa).
    let live: Match[] = base?.live ?? [];
    let degraded = base?.degraded ?? false;
    let updatedAt = base?.updatedAt ?? now.toISOString();
    let fixtures = base?.fixtures;
    let fixturesUpdatedAt = base?.fixturesUpdatedAt;
    let fixturesAttemptedAt = base?.fixturesAttemptedAt;
    // The snapshot's season: the cached one (sealed like any other value read
    // back from the file) until this cycle's live response replaces it.
    let season: SeasonInfo | undefined = sealSeason(base?.season);
    // The season the `fixtures` slice belongs to: what was STORED WITH IT while
    // the slice is carried, its own response's once this cycle refetches it.
    // Never re-derived from the live season, which can go unknown in between.
    let fixturesSeason: SeasonInfo | undefined = sealSeason(base?.fixturesSeason);
    // The adapter runs on the refresher's clock (an injected `now` plus the
    // real time elapsed since), so its absolute cooldown deadline and the
    // snapshot's `backoffUntil` are on the same timeline.
    const realStart = Date.now();
    const clock = () => nowMs + (Date.now() - realStart);
    const adapter = liveAdapter(source, competition, clock);

    if (needLive) {
      // Use the domain helper, not adapter.fetchLive() directly: it fetches a
      // ±1-day window around `now` so a late kickoff filed under the provider's
      // adjacent day bucket is still detected (see core getLiveMatches). Without
      // this the statusline cache reads empty mid-match and shows a countdown.
      // getLiveMatches fails closed internally; the try also guards adapter
      // construction so any error degrades rather than skipping the cache write.
      try {
        const r = await getLiveMatches(adapter, now);
        live = r.matches;
        degraded = r.degraded;
        // The stored season describes the response that last refreshed `live`.
        // A response that ANSWERED replaces it with whatever it stated — and if
        // it stated no readable season, with nothing: fresh live data must not
        // be published under the previous response's season. A fetch that
        // failed replaced nothing, so the snapshot keeps the season it had.
        if (!r.degraded) season = r.season;
      } catch {
        degraded = true;
      }
      updatedAt = now.toISOString();
    }

    // The backoff again, before the second lane, asked the way every reader
    // asks it and at the time it is NOW: a command can have been told to stop
    // while the first lane was in flight (the note), and a deadline the
    // snapshot carried can have come inside the bound since the cycle decided.
    // (A throttle this cycle met itself is on the adapter, which then refuses
    // without a request.)
    if (needFixtures && backoffInEffect(base, source, competition, clock()) === undefined) {
      // Fail closed: getKnockoutFixtures returns degraded on a provider error —
      // KEEP the prior cached fixtures + timestamp rather than caching an empty
      // list as a real "no knockouts" (a transient outage must never read as
      // "your team is out"). Only a SUCCESSFUL fetch updates the slice + clock;
      // the ATTEMPT clock always advances so failures re-poll on the short
      // cadence instead of every lock cycle.
      fixturesAttemptedAt = now.toISOString();
      try {
        const r = await getKnockoutFixtures(adapter, now);
        // An answer that left records out cannot prove a fixture is gone.
        // What it means for a slice that already holds something depends on
        // what is KNOWN about the two seasons:
        //   - the same season: a union. What the slice held and this answer
        //     did not READ stays, while it is still to be played. "Read" is
        //     asked of everything the answer read (`mentioned`), not of the
        //     upcoming ties it returns: a tie the provider just postponed was
        //     read, and must not be put back.
        //   - different seasons: the answer replaces the slice, as a whole
        //     answer does (one season per snapshot).
        //   - either one unknown: nothing can be merged (the two could be
        //     different editions) and nothing may be erased, so this is not an
        //     answer. The slice stands as it was, with its own stamp, and the
        //     attempt stamp paces the next ask, as after a failed fetch.
        // A slice with no tie still to be played has nothing an answer could
        // erase: any answer is taken.
        const atStake = (fixtures ?? []).some((old) => isUpcoming(old, now));
        const incomplete = !r.degraded && r.complete === false && atStake;
        const seasonsKnown = !!r.season && !!fixturesSeason;
        if (r.degraded || (incomplete && !seasonsKnown)) {
          /* keep prior fixtures + timestamp; retry on the short cadence */
        } else {
          const read = new Set(r.mentioned ?? r.fixtures.map((m) => m.id));
          const kept =
            incomplete && r.season?.year === fixturesSeason?.year
              ? (fixtures ?? []).filter((old) => !read.has(old.id) && isUpcoming(old, now))
              : [];
          fixtures = [...r.fixtures, ...kept].sort(byKickoff);
          fixturesUpdatedAt = now.toISOString();
          fixturesSeason = r.season;
        }
      } catch {
        /* keep prior fixtures + timestamp; retry next cycle */
      }
    }

    // ONE SEASON PER SNAPSHOT. The state's season is the live response's. The
    // fixtures slice stays only if nothing says it belongs to a DIFFERENT one:
    // carried from a cache written for another season (a rollover), or just
    // refetched but answered for another season (an old binary in a new
    // edition: its bundled knockout window still answers for the bundle's
    // year). Either way it is dropped, never merged — the cache is replaced
    // whole. An unknown season on either side is not "different". (The hot
    // path cannot detect a new season; it takes this one refresh. The backoff
    // below is about the provider, not a season, and stays.)
    //
    // The ATTEMPT stamp stays too. It records that the window was asked for,
    // which is true whatever became of the answer, and it is what paces the
    // next ask: a cache with neither stamp is "infinitely stale", so erasing
    // it here made a disagreement that persists refetch the window on every
    // prompt. With it, a slice dropped right after its own fetch is asked for
    // again on the empty-result cadence, and a carried one as soon as its last
    // attempt is that old — once, promptly, which is what a rollover wants.
    if (season && fixturesSeason && season.year !== fixturesSeason.year) {
      fixtures = undefined;
      fixturesUpdatedAt = undefined;
      fixturesSeason = undefined;
    }

    const backoffUntil = backoffToPublish(base, adapter, source, competition, nowMs, clock(), opts.jitterMs);

    // Fenced on ownership: if the lease went stale mid-fetch and a successor
    // took over, its snapshot is newer than ours and must stand (audit A10).
    const published = publishState(
      {
        updatedAt,
        live,
        degraded,
        source,
        competition,
        ...(fixtures ? { fixtures } : {}),
        ...(fixturesUpdatedAt ? { fixturesUpdatedAt } : {}),
        ...(fixturesAttemptedAt ? { fixturesAttemptedAt } : {}),
        ...(backoffUntil ? { backoffUntil } : {}),
        ...(season ? { season } : {}),
        // Stored with the slice it describes, and only while that slice exists.
        ...(fixtures && fixturesSeason ? { fixturesSeason } : {}),
      },
      token,
    );
    if (!published) noteRefusedPublish(backoffUntil, source, competition, clock());
  } finally {
    releaseLock(token);
  }
}

/**
 * The backoff a cycle publishes.
 *
 * The provider told us to go away (429/403) → persist a jittered backoff that
 * every refresh trigger honors, at least as long as the provider's own
 * Retry-After (already bounded by the adapter — audit A12). Read the adapter's
 * RETAINED window, not lastError (a later non-throttle failure overwrites
 * lastError while the window stands), and persist its ABSOLUTE deadline: the
 * provider's Retry-After counts from receipt, so a slow response must not have
 * its latency subtracted (review P2 on #128).
 *
 * EVERY writer of a deadline keeps the later of the ones it believes: the one
 * the snapshot carried and the scope's note (the same question every reader
 * asks), and the one this cycle was given. An expired or unbelievable one
 * takes no part, so it is dropped here rather than carried forever.
 */
function backoffToPublish(
  base: CacheState | undefined,
  adapter: ProviderAdapter,
  source: string,
  competition: string,
  nowMs: number,
  at: number,
  jitterMs: number | undefined,
): string | undefined {
  const armed = adapter.cooldownUntil;
  const jitter = jitterMs ?? Math.floor(Math.random() * BACKOFF_JITTER_MS);
  const deadlines = [
    backoffInEffect(base, source, competition, at),
    armed !== undefined && armed > at ? Math.max(armed, nowMs + BACKOFF_MS) + jitter : undefined,
  ].filter((d): d is number => d !== undefined);
  return deadlines.length > 0 ? new Date(Math.max(...deadlines)).toISOString() : undefined;
}

/**
 * A publish was refused: the lease was lost and the snapshot is the
 * successor's. A throttle this cycle was given is still a fact about the
 * provider, and the successor may not have met it: it goes to the note, which
 * needs no lock, like a command's that could not get one.
 */
function noteRefusedPublish(backoffUntil: string | undefined, source: string, competition: string, at: number): void {
  if (backoffUntil) writeBackoffNote(source, competition, Date.parse(backoffUntil), at);
  if (process.env.CLAUDINHO_DEBUG) {
    process.stderr.write('claudinho: refresh lease lost to a successor; snapshot not published\n');
  }
}

/**
 * One cycle for a competition the bundled schedule does not describe.
 *
 * Under the lock, from the state read under it: discovery if it is due (the
 * schedule ahead, on its own cadence); the backoff again; the gate, on the
 * slice as it now is; a live read if the gate is open and the live slice is at
 * least `MIN_REFRESH_MS` old; ONE publish. Every rule about the slice is in
 * `scheduleSlice.ts`; this is the order they are applied in.
 *
 * A cycle that only discovers copies the live slice and its stamp through
 * untouched. The knockout `fixtures` slice is the bundle's and is never filled
 * here.
 */
async function refreshOffBundle(c: {
  now: Date;
  source: string;
  competition: string;
  readBase: () => CacheState | undefined;
  writeIdleSnapshot: () => void;
  jitterMs: number | undefined;
}): Promise<void> {
  const { now, source, competition, readBase } = c;
  const nowMs = now.getTime();
  const plan = (snapshot: CacheState | undefined) => {
    const view = scheduleView(snapshot?.schedule, nowMs);
    const inBackoff = backoffInEffect(snapshot, source, competition, nowMs) !== undefined;
    return {
      view,
      needDiscovery: !inBackoff && discoveryDue(view),
      needLive:
        !inBackoff &&
        scheduleGateOpen(view, nowMs, { probe: true }) &&
        ageMs(snapshot, nowMs) >= MIN_REFRESH_MS,
    };
  };

  // A first look, WITHOUT the lock: it may only decide not to ask.
  const first = readBase();
  const early = plan(first);
  if (!early.needDiscovery && !early.needLive) {
    if (!first) c.writeIdleSnapshot();
    return;
  }

  const token = claimLock();
  if (!token) return;
  try {
    const base = readBase();
    const { view, needDiscovery, needLive } = plan(base);
    if (!needDiscovery && !needLive) return;

    const realStart = Date.now();
    const clock = () => nowMs + (Date.now() - realStart);
    const adapter = liveAdapter(source, competition, clock);

    // The live slice, carried unless this cycle reads it.
    let live: Match[] = base?.live ?? [];
    let degraded = base?.degraded ?? false;
    let updatedAt = base?.updatedAt ?? NEVER;
    let season: SeasonInfo | undefined = sealSeason(base?.season);
    // The schedule slice AS IT IS BELIEVED (`scheduleView`): what is carried
    // and written back is what was read through the rules, never the raw file.
    let index = view.index;
    let display: Match[] = [...sealFixtures(base?.schedule?.fixtures).items];
    let scheduleSeason = view.season;
    let complete = base?.schedule?.complete === true;
    let scheduleUpdatedAt = carriedStamp(base?.schedule?.updatedAt, nowMs);
    let attemptedAt = carriedStamp(base?.schedule?.attemptedAt, nowMs);
    let failures = view.failures;
    let inPlayUntil = view.inPlayUntil;
    let probe = view.probe;
    let throttled = false;

    const snapshot = (backoffUntil: string | undefined): CacheState => ({
      updatedAt,
      live,
      degraded,
      source,
      competition,
      ...(backoffUntil ? { backoffUntil } : {}),
      ...(season ? { season } : {}),
      schedule: {
        ...(index ? { index, complete } : {}),
        ...(display.length > 0 ? { fixtures: display } : {}),
        ...(scheduleUpdatedAt ? { updatedAt: scheduleUpdatedAt } : {}),
        ...(attemptedAt ? { attemptedAt } : {}),
        failures,
        ...(scheduleSeason ? { season: scheduleSeason } : {}),
        ...(inPlayUntil !== undefined ? { inPlayUntil: new Date(inPlayUntil).toISOString() } : {}),
        ...(probe ? { probe: true } : {}),
      },
    });

    if (needDiscovery) {
      // The attempt is WRITTEN before the request is made, counted as a
      // failure until an answer corrects it: a refresher that dies in the
      // middle has still paced the next one. If it cannot be written, nothing
      // is asked.
      const before = { attemptedAt, failures };
      attemptedAt = now.toISOString();
      failures = before.failures + 1;
      let written = false;
      try {
        written = publishState(snapshot(undefined), token);
      } catch {
        written = false;
      }
      if (!written) return;

      const answer = await getScheduleAhead(adapter, now);
      if ((adapter.cooldownUntil ?? 0) > clock()) {
        // A throttle is not a failed discovery. It is not counted, the attempt
        // is taken back (discovery is due again when the backoff ends, with no
        // wait of its own on top), nothing else is asked in this cycle, and no
        // probe is owed.
        throttled = true;
        attemptedAt = before.attemptedAt;
        failures = before.failures;
      } else {
        const next = applyDiscovery({ index, fixtures: display, season: scheduleSeason }, answer, nowMs);
        if (next) {
          index = next.index;
          display = next.fixtures;
          scheduleSeason = next.season;
          complete = next.complete;
          scheduleUpdatedAt = now.toISOString();
          failures = 0;
          // A match in play that no window covers is found here.
          inPlayUntil = raiseInPlay(inPlayUntil, answer.fixtures, nowMs);
        } else {
          // ONE path for every failure: the slice stands, the failure cadence
          // applies, and one live read is owed.
          probe = true;
        }
      }
    }

    // The backoff again (a command can have been told to stop while discovery
    // was in flight), then the gate, on the slice as it now is.
    const blocked = throttled || backoffInEffect(base, source, competition, clock()) !== undefined;
    const viewNow: ScheduleView = { ...view, index, inPlayUntil, probe };
    if (!blocked && scheduleGateOpen(viewNow, nowMs, { probe: true })) {
      if (ageMs(base, nowMs) >= MIN_REFRESH_MS) {
        // The stamp is the moment the read was ADMITTED, not the start of a
        // cycle that first waited for discovery.
        const admitted = clock();
        try {
          const r = await getLiveRead(adapter, now);
          live = r.matches;
          degraded = r.degraded;
          if (!r.degraded) season = r.season;
          // An observation never lowers the continuation; only a read that
          // succeeded, was WHOLE and holds no match in play ends it.
          if (r.matches.length > 0) inPlayUntil = raiseInPlay(inPlayUntil, r.matches, nowMs);
          else if (!r.degraded && r.complete) inPlayUntil = undefined;
        } catch {
          degraded = true;
        }
        updatedAt = new Date(admitted).toISOString();
      }
      // Asked just now, or answered by a read less than `MIN_REFRESH_MS` old:
      // either way the probe has its answer, whatever that was.
      probe = false;
    }

    const backoffUntil = backoffToPublish(base, adapter, source, competition, nowMs, clock(), c.jitterMs);
    const published = publishState(snapshot(backoffUntil), token);
    if (!published) noteRefusedPublish(backoffUntil, source, competition, clock());
  } finally {
    releaseLock(token);
  }
}

/**
 * Whether a match can be in play, as far as the hot path can know: on the
 * bundled competition the bundled schedule's windows; off it, the schedule
 * slice's gate (a discovered window, a match seen in play, or a probe owed).
 */
function liveGateOpen(
  now: number,
  state: CacheState | undefined,
  competition: string,
  view?: ScheduleView,
): boolean {
  if (bundleApplies(competition)) return inLiveWindow(now);
  return scheduleGateOpen(view ?? scheduleView(state?.schedule, now), now, { probe: true });
}

/**
 * Decide whether a refresh is warranted right now (live window + stale cache +
 * no active backoff + nobody already refreshing). Pass the already-read `state`
 * to avoid a second cache read on the hot path.
 */
export function shouldRefresh(
  now: number,
  state: CacheState | undefined,
  competition: string,
  source = 'espn',
  /** The schedule slice, already read (the hot path reads it once for both questions). */
  view?: ScheduleView,
): boolean {
  if (!liveGateOpen(now, state, competition, view)) return false;
  if (isLockFresh(now)) return false;
  if (!(ageMs(state, now) > LIVE_TTL_MS)) return false;
  // LAST: the snapshot's backoff or the scope's note. The note is one more
  // small file, so it is looked at only once a refresh would otherwise be
  // started, not on every prompt inside a window (`backoff-hotpath.test.ts`
  // counts the reads).
  return backoffInEffect(state, source, competition, now) === undefined;
}

/**
 * Decide whether to refresh the cached knockout `fixtures` — the trigger that
 * keeps the statusline's next-match countdown live OUTSIDE live windows (when
 * `shouldRefresh` is false). True only in the knockout phase, when the cached
 * fixtures are stale, no backoff is active, and nobody's already refreshing.
 * Pass the already-read `state` to avoid a second cache read on the hot path.
 */
export function shouldRefreshFixtures(
  now: number,
  state: CacheState | undefined,
  competition: string,
  source = 'espn',
): boolean {
  if (!inKnockoutPhase(now, competition)) return false;
  if (isLockFresh(now)) return false;
  if (!fixturesStale(state, now)) return false;
  // Last, like `shouldRefresh`.
  return backoffInEffect(state, source, competition, now) === undefined;
}

/**
 * Decide whether to DISCOVER: off the bundled competition, when the schedule
 * ahead is due to be read again (its own cadence, anchored on the last
 * attempt), no backoff is in effect, and nobody is already refreshing.
 */
export function shouldDiscover(
  now: number,
  state: CacheState | undefined,
  competition: string,
  source = 'espn',
  view?: ScheduleView,
): boolean {
  if (bundleApplies(competition)) return false;
  if (isLockFresh(now)) return false;
  if (!discoveryDue(view ?? scheduleView(state?.schedule, now))) return false;
  return backoffInEffect(state, source, competition, now) === undefined;
}

/**
 * THE trigger, for both hot-path surfaces (the statusline and the hook copied
 * one condition; it is one function now): start a refresher when there is no
 * snapshot, or a match can be in play and the live slice is stale, or the
 * knockout slice is due (on the bundle), or discovery is due (off it). Never
 * during a backoff, and never while a refresher is already running. Reads the
 * already-loaded `state` and, last, the scope's throttle note; no network.
 */
export function refreshWanted(
  now: number,
  state: CacheState | undefined,
  competition: string,
  source = 'espn',
): boolean {
  if (!state) return !isLockFresh(now);
  // Off the bundle the slice is read ONCE for both of its questions.
  const view = bundleApplies(competition) ? undefined : scheduleView(state.schedule, now);
  return (
    shouldRefresh(now, state, competition, source, view) ||
    shouldRefreshFixtures(now, state, competition, source) ||
    shouldDiscover(now, state, competition, source, view)
  );
}

/**
 * Fire-and-forget a detached refresher process. Returns immediately; the child
 * outlives this process and writes the cache for the next render.
 */
export function spawnRefresh(source: string, competition: string): void {
  try {
    const entry = process.argv[1];
    if (!entry) return;
    const child = spawn(process.execPath, [entry, '_refresh', '--source', source], {
      detached: true,
      stdio: 'ignore',
      // The child resolves its competition at ITS edge, from its environment.
      // Hand it the one this process already resolved, so the refresher writes
      // the cache the statusline that spawned it will read — whatever source
      // (flag, environment, later a saved choice) the parent's selection had.
      env: { ...process.env, CLAUDINHO_COMPETITION: competition },
      // Windows: a detached child gets its own console window without this —
      // the statusline would flash one every ~12–15s during live matches.
      windowsHide: true,
    });
    child.unref();
  } catch {
    /* best effort — never break the hot path */
  }
}
