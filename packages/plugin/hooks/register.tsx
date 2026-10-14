import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type {
  ClaudinhoBand,
  ClaudinhoBaseline,
  ClaudinhoCelebration,
  ClaudinhoContext,
  ClaudinhoGoal,
  ClaudinhoPace,
  ClaudinhoPane,
  ClaudinhoPanePart,
  ClaudinhoPaneRow,
  ClaudinhoPlay,
  ClaudinhoTally,
} from '../types'

/**
 * The claudinho plugin: the live score or the countdown above the prompt (the band), a toast when a score changes,
 * the live score beside the prompt for the model (none under `context: off`), `/claudinho`, the band's line on demand,
 * and the match pane (`/claudinho match`).
 *
 * The CLI owns the data (its cache, its refresher, the network, the backoff) and the words: the plugin never fetches.
 * This module runs the one binary, `claudinho ambient --json` (the band's runs add `--columns <the band's columns>`;
 * the pane runs `claudinho match <id> --json`, whose read of the provider is the CLI's), with an argument array,
 * bounded, and reads the fields of the one JSON object it prints, never its text: what the line IS (`idle`, `empty`,
 * the first run's `noCompetition`), whether its list is `current`, and the hook's own line on each record, said
 * verbatim. No binary, a timeout, a cut or an answer that is not the object: the band shows nothing (the command says
 * so in one fixed sentence), never a blocked turn. Every run is also what
 * triggers the CLI's refresher, so the band runs at the live pace on every line but the idle ones. Best effort
 * throughout: a toast says a score change this module observed between two current views, never every goal.
 * The band draws the CLI's `lineParts` (CLI 0.12.0), each `strong` part bold, only when their texts join to the line;
 * else the plain line.
 *
 * The toasts (`momentsFor`), per match between two current views, under `toasts`: a record that carries `names` (CLI
 * 0.12.0) says what happened, from the CLI's fields alone: `⚽ GOAL! <team>` for one side up by exactly 1 (the scorer
 * and the goal's minute only when `lastGoal` is a new identity on that side, a proven own goal `⚽ Own goal · <team>`,
 * else the record's clock minute), `Goal for <team>` for the side opposite `pinnedSide`, `Goals` for more than one,
 * `Score updated` for a tally that fell, `Penalties` for a shootout tally that rose (in that order of precedence), each
 * with the scoreline from `names`; and full time, a record of the last current view's live list now in `finished`
 * (the goal toast first when its tally rose in the same read, then `Full time ·` the scoreline and the result). A
 * record without `names` (CLI 0.11.2) toasts today's `⚽` and its own `line`, and no full time is said for it.
 *
 * The band runs while a surface that draws it is attached: the terminal or the desktop app, the two that raise
 * `AbovePrompt`, asked of the session's roster at every run, first and again as the last step before the spawn (the
 * desktop app's session starts with no surface and attaches after; a plugin loaded into an open desktop session hears
 * a start with no surface while the roster holds the desktop). A run that finds none attached (`claude -p`, the SDK, a
 * phone or an editor alone), or cannot read the roster, starts no process and clears the band. A roster read refused at
 * the start is unknown, so the pace starts and each run asks again: a read denied for good costs one read per 15
 * seconds and no process. Each run is handed a PATH: the host's own, then the folders npm, Homebrew, nvm, Volta, pnpm
 * and Bun install global commands into, so a session started with a bare PATH still finds the CLI and its `node` (on
 * Windows nothing is handed). nvm's part is looked up once per load; while that lookup has not answered, each run waits
 * at most a second for it and uses the PATH without nvm's folders, and the first run that finds it answered keeps the
 * PATH with them. A band drawn beneath ours in the hook chain (a plugin registered after ours, or the engine's own)
 * stays, under our line: we never drop it.
 * A run's answer is drawn only if no clear (a window leaving, or a run finding none) happened since the run began its spawn.
 *
 * `/claudinho` is registered at every start, headless included, and answers by itself: one `claudinho ambient --json`
 * run on the band's PATH, read by the band's own reading of the answer (`readAnswer`), replied as the view's line or
 * one fixed sentence chosen by what the answer says. With no `--columns` the CLI fits the line to its own ceiling,
 * 200 display columns, never to the window: past it the CLI keeps its `+N` count of the other matches, or ends an
 * over-wide segment with `…`; the transcript row wraps what it draws. A reply made from a view (its line, or the idle
 * or empty sentence) ends with the view's own provider attribution and then its disclaimer, each after a blank line,
 * relayed from its `attribution` and `disclaimer` fields (each only when usable), never spelled here; a reply made
 * from no view is its sentence alone. Its run is its own: whatever the roster says,
 * it takes no part in the band's guard or pace, reads and writes no `$.state` value, raises no toast and clears
 * nothing; it shares only the kept PATH and nvm's lookup (`/claudinho match` writes the pane's two values alone, below).
 * The text typed after the command is read for one word alone: `match` (surrounding spaces aside) opens the match pane;
 * any other text is ignored.
 *
 * The match pane: `/claudinho match` binds, from the command's own reading, a view's competition (its slug) and the
 * first record of its live list (the CLI lists the pick first), else its `next`; nothing to bind, no read and no pane.
 * It writes the pane's value under a new generation (`paneGen`), first a provisional one (the view's line and footer),
 * and opens the pane `match` at once inside the hook (an open is the person's only within about 15 s of the command,
 * measured); then it runs `claudinho match <id> --json` once (5 s, the whole stdout ONE JSON value), whose answer
 * replaces the provisional value; the reply is the view's line and ` · match pane open` when the pane opened with the
 * CLI's rows on a surface that draws it (the pane carries the attribution and the disclaimer), else the bare one
 * (headless, nothing to bind, a first read that failed). A match run names no competition, so the CLI resolves the
 * person's own choice (its mode row says where it came from); an answer of another competition, or the first-run object
 * (nothing chosen now), is never used: the binding is pinned for good and the read is made once more with
 * `--competition <slug>`. The pane draws the CLI's `rows` by their parts' styles when they join to its `lines` (CLI
 * 0.12.0: strong bold, dim dimmed, accent and flair the theme's `success`, quote dimmed italic), else its `lines`
 * verbatim (at most 150, each cut at 600 characters, each
 * wrapped), a blank row, then the `attribution` and the `disclaimer` dimmed (each at 1,000), or one fixed sentence: a
 * first read that failed, or an answer with no `lines` (a CLI before them). While open it re-reads the bound match: on
 * a band run's CURRENT view of the bound competition that shows its score or shootout tally changed from the band's
 * previous observation (seeded by the open's reading; consumed once), or lists it newly (kickoff) or no more (full
 * time); at its kickoff alone while the last answer is not in play and its kickoff is ahead (degraded or not); every 2
 * minutes otherwise: in play (`LIVE`, `HT`), failed, no match, a kickoff passed or unreadable. One read in flight at
 * most, the open's included (it waits for the read in flight, whose answer its new binding fences off; a trigger during
 * either is kept once); a read writes only under its generation; a failed re-read keeps the rows under a fixed row;
 * none after a final answer (`FT`, `POSTPONED`, `CANCELLED`) or once closed. The close (`ui.close` for `match`) moves
 * the generation on and drops the value, the binding and the timers. The binding and the timers are this module load's:
 * after a reload the pane stays drawn from its value and is re-read again from the next `/claudinho match`.
 *
 * The goal celebration: when a run's toasts include a goal, the band plays it above its line in at most
 * min(3, maxRows - 2) rows, then goes back to its one line. For a record without `names` (CLI 0.11.2), any goal (a
 * regulation or shootout tally that rose, none that fell): 6 frames over 3 seconds, a ball crossing a row, a "GOAL"
 * banner growing, then the toast's own line. For a record with `names`, a single-goal toast for the pinned side (with
 * no `pinnedSide`, any): 3 seconds of Anthropic's Claude mascot as three rows of text art (the theme's `claude`
 * colour, its legs alternating) beside the ball crossing the top row, `GOAL!` (bold, the theme's `success`) and the
 * team on the middle row, the scorer and minute (or the minute) on the bottom row; two rows: the words alone; one:
 * `GOAL! <team> <minute>`; none: it waits. `Goal for`, `Goals`, `Penalties` and `Score updated` play nothing. Full
 * time for the pinned side's win or draw: the mascot beside `Full time · <result>` for 5 seconds, queued behind the
 * goal of the same read (the record's `queue`, played as one stretch). Its record (`celebration`: the first play, its
 * queue, when the run decided it, its competition, its match's id and that match's tallies it was decided on) is
 * written by the run and the clear alone: in a run, any answer naming another competition, or none, current or not (a
 * view, or the first-run object), nulls it, then its match's score changing from the record's own in any later
 * current view, live or finished (a correction, or a later goal the plugin did not see as one; by the record's id,
 * whatever the `toasts` filter) nulls it, both plays with it, then the run's last match with a play replaces it under
 * the band's clear generation; the existing clear nulls it. Every null also stops the redraws. A record another module
 * load wrote is never played (its `at` is not this load's), so a reload drops a waiting or playing celebration (the
 * toast already said it); it stays in state until a goal or a clear replaces it. A played or expired record stays
 * until the next goal replaces it: the draw ignores it. The draw only reads it, and computes the play and its frame
 * from module values (how much of its plays has been on screen), redrawn by a 500 ms ticker that runs only while there
 * is something to play and no hold: a main-loop turn (`turn.start` to a `turn.complete` with no `agentId`) or the
 * drawn `isWorking` holds it, and it plays when the hold ends within 60 seconds of the goal. A paused celebration
 * never resumes after 60 seconds; a stretch on screen finishes its plays. `celebrate: off` plays
 * nothing.
 */

const band = atom({ plugin: 'claudinho', key: 'band' } as const, null as ClaudinhoBand)
const pace = atom({ plugin: 'claudinho', key: 'pace' } as const, { ranAt: 0, idle: false } as ClaudinhoPace)
const baseline = atom({ plugin: 'claudinho', key: 'baseline' } as const, null as ClaudinhoBaseline)
const lastContext = atom({ plugin: 'claudinho', key: 'context' } as const, null as ClaudinhoContext)
const celebration = atom({ plugin: 'claudinho', key: 'celebration' } as const, null as ClaudinhoCelebration)
const paneGen = atom({ plugin: 'claudinho', key: 'paneGen' } as const, 0 as number)
const pane = atom({ plugin: 'claudinho', key: 'pane' } as const, null as ClaudinhoPane)

const LIVE_MS = 15_000
const IDLE_MS = 300_000
const RUN_TIMEOUT_MS = 2_000
/** The command's one line in the typeahead and `/help`: facts only. */
const COMMAND_DESCRIPTION = 'The live score or the next fixture of the competition you follow, now'
/** The command's replies where the band would show nothing, by what the CLI's answer says (never by a cause). */
const REPLY_FAILED = 'The CLI gave no answer.'
const REPLY_FIRST_RUN = 'No competition followed yet.'
const REPLY_NO_VIEW = "Nothing to show: the CLI's answer is not one this plugin reads."
const REPLY_EMPTY = 'Nothing to show right now: no live match and no next fixture known.'
const REPLY_IDLE = 'The edition you follow is over.'
/** The prompt context is attached only from a run younger than two periods. */
const CONTEXT_MAX_AGE_MS = 2 * LIVE_MS
/** The band's width before any draw. */
const DEFAULT_COLUMNS = 80
/** A celebration frame's length; six frames are its whole length, after which it is spent. */
const FRAME_MS = 500
const FRAMES = 6
const PLAY_MS = FRAMES * FRAME_MS
/** A celebration not on screen this long after its goal is dropped (the toast already said it). */
const CELEBRATION_MAX_AGE_MS = 60_000
/** The banner, the plugin's one composed word: `G`, `GO`, `GOA`, `GOAL`, `GOAL!`, `GOAL!` frame by frame. */
const BANNER = 'GOAL!'
/** The ball's display width (an emoji takes two columns). */
const BALL_COLUMNS = 2
/** Full time's play, for the pinned side's win or draw: 5 s on screen. */
const FULLTIME_MS = 5_000
/**
 * Anthropic's Claude mascot, as three rows of text art (its head, its body, its legs in two steps), drawn in the
 * theme's `claude` colour in the goal and full-time celebrations only. It stands left of the celebration's three rows.
 */
const MASCOT_HEAD = ' ▐▛███▜▌'
const MASCOT_BODY = '▝▜█████▛▘'
const MASCOT_LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const
/** The mascot's widest row, and the column between it and the celebration's text. */
const MASCOT_COLUMNS = 9
const MASCOT_GAP = 1
/** The theme keys the moments are drawn in: the mascot's, and the goal word's (the pane's accent and flair too). */
const MASCOT_COLOR = 'claude'
const GOAL_COLOR = 'success'
/** The band's `lineParts` read, at most. */
const LINE_PARTS_MAX = 64
/** A pane row's parts kept, at most. */
const PANE_ROW_PARTS_MAX = 64
/** The kinds of goal a `lastGoal` names, and the minutes it is believed for. */
const GOAL_TYPES: readonly string[] = ['GOAL', 'OWN_GOAL', 'PEN']
const MINUTE_MAX = 200
/** The reply's note when `/claudinho match` opened the pane on a surface that draws it. */
const PANE_OPEN_NOTE = ' · match pane open'
/** The pane's part styles the plugin draws; another is a plain part. */
const PANE_STYLES: readonly string[] = ['strong', 'dim', 'accent', 'quote', 'flair']
/** The match pane: its one id, its title, the word typed after the command that opens it. */
const PANE_ID = 'match'
const PANE_TITLE = 'claudinho'
const PANE_WORD = 'match'
/** A `match` run's bound: one match read is several provider requests, measured at about half a second. */
const MATCH_TIMEOUT_MS = 5_000
/** The pane's bounds: rows of `lines`, each row's characters, and the attribution's and the disclaimer's. */
const PANE_LINES_MAX = 150
const PANE_LINE_CHARS = 600
const PANE_FOOTER_CHARS = 1_000
/** The re-read while the last answer is in play, failed, or had no match. */
const PANE_EVERY_MS = 120_000
/** The longest delay a timer is armed for (a platform timer's limit); a kickoff further out re-reads then. */
const TIMER_MAX_MS = 2_147_483_647
/** The pane's fixed rows: a re-read that failed (above the last rows), a first read that failed, an answer it does not read. */
const PANE_REFRESH_FAILED = 'Could not refresh: showing the last reading.'
const PANE_FAILED = REPLY_FAILED
const PANE_NO_VIEW = REPLY_NO_VIEW
/** The statuses `match --json` states; a final one ends the re-reads. */
const STATUSES = ['SCHEDULED', 'LIVE', 'HT', 'FT', 'POSTPONED', 'CANCELLED'] as const
const FINAL_STATUSES: readonly string[] = ['FT', 'POSTPONED', 'CANCELLED']

type ToastsOption = 'pinned' | 'all' | 'off'
const TOASTS_OPTIONS: readonly ToastsOption[] = ['pinned', 'all', 'off']

/**
 * The band's width as last drawn (`bodyColumns`), which the next run asks the CLI to fit the line to. Kept in the
 * module, not `$.state`: the draw that learns it may not write state. A reload starts again from the default.
 */
let columns = DEFAULT_COLUMNS
let clears = 0
/** At most one run in flight: the guard is taken before the first await. */
let busy = false
/** A forced run asked while a run was in flight: made as soon as that run ends (cleared when it starts). */
let forcedPending = false
/**
 * The pace (the forced first run, then every 15 seconds) is started once per module load, by whichever comes first of
 * a start or an attach of a band surface. A reload makes a fresh module and drops the previous one's timers.
 */
let paced = false
/**
 * The `env` every run is handed, kept for the rest of the module load once it is whole (nvm's lookup answered, or not
 * needed); `env` undefined: none, on Windows.
 */
let runEnvKept: { env: { PATH: string } | undefined } | null = null
/** nvm's lookup, started once per module load by the first run that needs it. */
let nvmOnce: Promise<string[]> | null = null
/** nvm's lookup's answer once it has settled. */
let nvmAnswer: string[] | null = null
/** Whether the goal celebration plays (`celebrate` is anything but `off`), set at load. */
let celebrateOn = true
/** Whether a prompt carries the live score (`context` is anything but `off`), set at load. */
let contextOn = true
/** A main-loop turn is running: set by `turn.start`, cleared by a `turn.complete` with no `agentId`. */
let holdTurn = false
/**
 * The celebration's playback, kept in the module (a draw may not write state): the record's `at` these values belong
 * to, how much of its 3 s was on screen before the current stretch, when the current stretch began (null while
 * paused), and the last draw that played it. A new record resets them; a pause folds the stretch into `playedMs`.
 */
let playingAt: number | null = null
let playedMs = 0
let playFrom: number | null = null
let lastPlayedAt = 0
/** The redraw ticker, running only while a celebration is playable and not held. */
let ticker: Timer | null = null
/**
 * The match pane's binding in this module load: the generation it was opened under (the `paneGen` the open wrote),
 * its competition and match id, whether its last answer was final, and whether its reads name the competition
 * (`pinned`: set for good by the first answer of another competition, or of none). Replaced by every open, nulled by
 * the close: a read whose binding is no longer this object writes nothing.
 */
type Binding = { gen: number; slug: string; id: string; final: boolean; pinned: boolean }
let bound: Binding | null = null
/** The band's previous observation of the bound id, under its generation: whether it was listed, and its tallies. */
type Observation = { gen: number; listed: boolean; score?: Tally; shootout?: Tally }
let observed: Observation | null = null
/**
 * The pane's `match` reads in flight or waiting their turn (the open counts from before it waits), and a re-read asked
 * during one (kept once). `readTail` settles when the last read queued has settled: the open waits for it, so no two
 * `match` runs are ever in flight at once.
 */
let paneReads = 0
let rereadPending = false
let readTail: Promise<void> = Promise.resolve()
/** The 2-minute re-read and the kickoff re-read. */
let everyTimer: Timer | null = null
let kickoffTimer: Timer | null = null

/** The two surfaces that raise `AbovePrompt`. */
const drawsBand = (surface: unknown): boolean => surface === 'terminal' || surface === 'desktop'

/** Whether a surface that draws the band is attached to the session now (a read that rejects is the caller's to read). */
const drawable = async ($: EngineInterface): Promise<boolean> => (await $.session.surfaces()).some(drawsBand)

/**
 * The band cleared and the pace back to its initial value (no clock read), so the next run the roster allows is never
 * held by an idle gap.
 */
async function clear($: EngineInterface): Promise<void> {
  clears += 1
  stopTicker()
  await update($, band, () => null)
  await update($, pace, () => ({ ranAt: 0, idle: false }))
  await update($, celebration, () => null)
}

/** How much of the record's 3 s has been on screen at `now` (the stretch in progress included). */
const playedAt = (now: number): number => playedMs + (playFrom === null ? 0 : Math.max(0, now - playFrom))

/** A play's length on screen: full time's 5 s, a goal's 3 s. */
const playLength = (p: ClaudinhoPlay): number => (p.kind === 'fulltime' ? FULLTIME_MS : PLAY_MS)

/** A record's plays in order: its own, then its queue (at most one more). */
const playsOf = (rec: NonNullable<ClaudinhoCelebration>): ClaudinhoPlay[] => [
  rec,
  ...(Array.isArray(rec.queue) ? rec.queue.slice(0, 1) : []),
]

/** A record's whole length on screen: its plays one after the other. */
const recordLength = (rec: NonNullable<ClaudinhoCelebration>): number =>
  playsOf(rec).reduce((sum, p) => sum + playLength(p), 0)

/**
 * Whether a record has anything left to play at `now`: set, its plays not all on screen, and either within 60 s of its
 * goal or in a stretch on screen (which finishes its plays). A paused one never resumes after 60 s.
 */
const playable = (rec: ClaudinhoCelebration, now: number): boolean =>
  rec !== null &&
  rec.at === playingAt &&
  playedAt(now) < recordLength(rec) &&
  (now - rec.at <= CELEBRATION_MAX_AGE_MS || playFrom !== null)

/** The playback paused at `at`: the stretch on screen folded into `playedMs`. */
function pausePlayback(at: number): void {
  if (playFrom === null) return
  playedMs += Math.max(0, at - playFrom)
  playFrom = null
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = null
}

/**
 * The redraw ticker: every 500 ms a redraw, then stopped once the record has nothing left to play (spent, expired or
 * gone). No state write per frame.
 */
function startTicker($: EngineInterface): void {
  if (ticker) return
  ticker = $.clock.every(FRAME_MS, () => {
    $.ui.invalidate('ui.render')
    void (async () => {
      const rec = await read($, celebration)
      if (!playable(rec, await $.clock.now())) stopTicker()
    })().catch(() => {
      // The engine's calls failed: the ticker runs on to its next period.
    })
  })
}

/** After a hold ends: the ticker again when the record is still playable. Never rejects. */
async function resumeTicker($: EngineInterface): Promise<void> {
  if (holdTurn) return
  const rec = await read($, celebration)
  if (!holdTurn && playable(rec, await $.clock.now())) startTicker($)
}

/** The ball row of a frame: the ball stepping right across `cols` columns, never past them. */
function ballRow(frame: number, cols: number): string {
  const room = Math.max(0, cols - BALL_COLUMNS)
  return `${' '.repeat(Math.floor((frame * room) / (FRAMES - 1)))}⚽`
}

/** The celebration's rows for a frame in `rows` rows (1 to 3): the frame table. */
function celebrationRows(frame: number, rows: number, text: string, cols: number): string[] {
  const last = frame === FRAMES - 1
  const banner = BANNER.slice(0, Math.min(frame + 1, BANNER.length))
  if (rows >= 3) return last ? [ballRow(frame, cols), banner, text] : [ballRow(frame, cols), banner]
  if (rows === 2) return [ballRow(frame, cols), last ? text : banner]
  return [last ? text : banner]
}

/** Whether a run may go on: a band surface is attached; a roster read that rejects is no. */
async function mayRun($: EngineInterface): Promise<boolean> {
  try {
    return await drawable($)
  } catch {
    return false
  }
}

/** An environment variable's value, or undefined when it is unset or its read rejected (an empty PATH or HOME adds nothing where it is used). */
async function orUnset(get: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    const value = await get()
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

const NVM_VERSION = /^v(\d+)\.(\d+)\.(\d+)$/
/** How long a run waits for nvm's lookup (the listing, the sort and the probes) before it goes on without it. */
const NVM_WAIT_MS = 1_000
/** The listing's entries read, before any per-entry work. */
const NVM_ENTRIES_MAX = 256
/** The version folders kept, the newest by number. */
const NVM_VERSIONS_MAX = 8

/**
 * nvm's version folders' `bin`, of the first 256 entries the listing gives, at most the 8 newest by number: those whose
 * `bin/claudinho` exists first, then the rest, each newest first; none when the folder cannot be listed (an error or a
 * refusal is an answer). Never rejects.
 */
async function nvmLookup($: EngineInterface, home: string): Promise<string[]> {
  const root = `${home}/.nvm/versions/node`
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(root)
  } catch {
    return []
  }
  const versions: Array<{ name: string; parts: [number, number, number] }> = []
  for (const entry of entries.slice(0, NVM_ENTRIES_MAX)) {
    const m = entry.kind === 'dir' ? NVM_VERSION.exec(entry.name) : null
    if (m) versions.push({ name: entry.name, parts: [Number(m[1]), Number(m[2]), Number(m[3])] })
  }
  versions.sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2])
  const bins = versions.slice(0, NVM_VERSIONS_MAX).map((v) => `${root}/${v.name}/bin`)
  // A folder that holds the CLI first: the node beside it is the one it was installed with. A probe that rejects is
  // "not there"; the probes run together.
  const holds = await Promise.all(
    bins.map((bin) =>
      $.fs.exists(`${bin}/claudinho`).then(
        (found) => found === true,
        () => false,
      ),
    ),
  )
  return [...bins.filter((_, i) => holds[i]), ...bins.filter((_, i) => !holds[i])]
}

/**
 * nvm's part of the PATH: the lookup's answer once it has settled, else null after this run has waited a second for it
 * (or at once when the wait cannot be kept). The lookup is started once per module load and never again.
 */
async function nvmBins($: EngineInterface, home: string): Promise<string[] | null> {
  if (nvmAnswer) return nvmAnswer
  nvmOnce ??= nvmLookup($, home).then((bins) => {
    nvmAnswer = bins
    return bins
  })
  const stop = new AbortController()
  const waited = $.clock.sleep(NVM_WAIT_MS, { signal: stop.signal }).then(
    () => null,
    () => null,
  )
  const bins = await Promise.race([nvmOnce, waited])
  if (bins) stop.abort()
  return bins
}

/**
 * The `env` a run is handed: none on Windows; else `PATH` = the host's PATH, then (under a HOME) nvm's version folders
 * and the user-level global-bin folders, then the system ones; each folder once, its first place kept, so the host's
 * order wins. `whole` is false while nvm's lookup has not answered (the PATH then has none of its folders). Never
 * rejects.
 */
async function computeRunEnv($: EngineInterface): Promise<{ env: { PATH: string } | undefined; whole: boolean }> {
  if ((await orUnset(() => $.env.get('OS'))) === 'Windows_NT') return { env: undefined, whole: true }
  let whole = true
  const folders: string[] = []
  const host = await orUnset(() => $.env.get('PATH'))
  if (host) folders.push(...host.split(':').filter((s) => s !== ''))
  // A folder under HOME only when HOME is an absolute path that holds no PATH separator.
  const home = await orUnset(() => $.env.get('HOME'))
  if (home?.startsWith('/') && !home.includes(':')) {
    const nvm = await nvmBins($, home)
    if (nvm) folders.push(...nvm)
    else whole = false
    folders.push(
      `${home}/.volta/bin`,
      `${home}/.local/share/pnpm`,
      `${home}/Library/pnpm`,
      `${home}/.bun/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.local/bin`,
    )
  }
  folders.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin')
  return { env: { PATH: [...new Set(folders)].join(':') }, whole }
}

/** The `env` for this run: the kept one, else computed now and kept when it is whole. */
async function runEnv($: EngineInterface): Promise<{ PATH: string } | undefined> {
  if (runEnvKept) return runEnvKept.env
  const { env, whole } = await computeRunEnv($)
  if (whole) runEnvKept = { env }
  return env
}

/**
 * What `claudinho ambient --json` prints, as far as this module reads it: a selected competition's VIEW (an object
 * with a `live` object holding an `items` array that says what its line is, `idle` and `empty` as two booleans), or
 * a shape that is no view: the first-run object (no competition chosen: `noCompetition`, the one line), the fallback
 * object (a refused value or a failure: the line and `empty`; an older CLI's `{ line }` has the same shape), and a
 * view from a CLI older than `idle` and `empty` (a live list and neither).
 */
type View = {
  line: string
  noCompetition?: unknown
  idle?: unknown
  empty?: unknown
  context?: unknown
  live?: { items?: unknown }
  next?: unknown
  current?: unknown
  competition?: { slug?: unknown } | null
  staleAfter?: unknown
  disclaimer?: unknown
  attribution?: unknown
  /** CLI 0.12.0: the line's parts, the score tokens `strong`. */
  lineParts?: unknown
  /** CLI 0.12.0: the records that finished in the last ten minutes. */
  finished?: unknown
}

type Item = {
  id: string
  line?: unknown
  score?: unknown
  shootout?: unknown
  pinned?: unknown
  minute?: unknown
  home?: unknown
  away?: unknown
  winnerCode?: unknown
  /** CLI 0.12.0: the names the hook's line uses, the saved pin's side, the last goal it proved. */
  names?: unknown
  pinnedSide?: unknown
  lastGoal?: unknown
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The first line of the CLI's stdout as the view (or the first-run object), or null for anything else (a run that failed). */
function parseView(stdout: string): View | null {
  const first = (stdout.split('\n')[0] ?? '').trim()
  if (!first) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(first)
  } catch {
    return null
  }
  if (!isObject(parsed) || typeof parsed.line !== 'string') return null
  return parsed as View
}

type RunResult = Awaited<ReturnType<EngineInterface['process']['run']>>

/**
 * What one run of the CLI said, read once for the band and the command alike: no answer (a run that rejected, a
 * non-zero exit, a cut stdout, a first line that is not the object), or the object and what its line IS. That comes
 * from the fields, never the text (which `--columns` may have cut): the first-run object (nothing chosen) is hidden and
 * idle; an object that is no view the plugin reads is hidden and not idle; a view that says `empty`, or whose line is
 * blank, is hidden; one that says `idle` is idle. A view the plugin reads has its `live` list AND says what its line
 * is, `idle` and `empty` as two booleans: the fallback object, an older CLI's `{ line }`, and a view from a CLI older
 * than those two fields (a live list and neither) are no view.
 */
type Reading =
  | { answered: false }
  | { answered: true; view: View; firstRun: boolean; isView: boolean; idle: boolean; hidden: boolean }

/** The one reading of a run's result (undefined: the run rejected). */
function readAnswer(r: RunResult | undefined): Reading {
  // A cut stdout is no answer: its first line may be part of an object.
  const view = r && r.exitCode === 0 && r.isStdoutTruncated !== true ? parseView(r.stdout) : null
  if (!view) return { answered: false }
  const firstRun = view.noCompetition === true
  const isView =
    !firstRun &&
    isObject(view.live) &&
    Array.isArray(view.live.items) &&
    typeof view.idle === 'boolean' &&
    typeof view.empty === 'boolean'
  const idle = firstRun || (isView && view.idle === true)
  const hidden = !isView || view.empty === true || view.line.trim() === ''
  return { answered: true, view, firstRun, isView, idle, hidden }
}

/** The reply's body for a view: nothing known, the edition over, else its line. */
const viewReply = (view: View, r: { hidden: boolean; idle: boolean }): string =>
  r.hidden ? REPLY_EMPTY : r.idle ? REPLY_IDLE : view.line

/** A sentence the CLI states for the plugin to relay, when it is usable: a string with something besides spaces. */
const relayed = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/**
 * The command's reply to a reading: the first that holds of a failed run, the first run, no view (each its sentence
 * alone), nothing known, the edition over; else the line. A reply made from a view ends with the view's attribution,
 * then its disclaimer (the CLI's own footer order), each after a blank line and each only when usable.
 */
function replyTo(reading: Reading): string {
  if (!reading.answered) return REPLY_FAILED
  if (reading.firstRun) return REPLY_FIRST_RUN
  if (!reading.isView) return REPLY_NO_VIEW
  const text = viewReply(reading.view, reading)
  // The CLI's own sentences, relayed (core's copy and core's one constant), never spelled here.
  const footer = [relayed(reading.view.attribution), relayed(reading.view.disclaimer)].filter((s) => s !== null)
  return [text, ...footer].join('\n\n')
}

/** A tally `{ home, away }` of two numbers, or undefined. */
function tally(v: unknown): { home: number; away: number } | undefined {
  if (!isObject(v) || typeof v.home !== 'number' || typeof v.away !== 'number') return undefined
  return { home: v.home, away: v.away }
}

/** The view's live matches that carry an id. */
function itemsOf(view: View): Item[] {
  const items = isObject(view.live) && Array.isArray(view.live.items) ? view.live.items : []
  return items.filter((m): m is Item => isObject(m) && typeof m.id === 'string')
}

/** The view's competition, by its slug ('' when it states none). */
const slugOf = (view: View): string =>
  isObject(view.competition) && typeof view.competition.slug === 'string' ? view.competition.slug : ''

type Tally = { home: number; away: number }

/**
 * How a match's tallies moved against its baseline entry: whether a side of a compared tally rose or fell (a tally
 * compared only when both carry one).
 */
function movement(m: Item, was: ClaudinhoTally): { rose: boolean; fell: boolean } {
  const pairs: Array<[Tally, Tally]> = []
  const score = tally(m.score)
  const shootout = tally(m.shootout)
  if (score && was.score) pairs.push([score, was.score])
  if (shootout && was.shootout) pairs.push([shootout, was.shootout])
  return {
    rose: pairs.some(([a, b]) => a.home > b.home || a.away > b.away),
    fell: pairs.some(([a, b]) => a.home < b.home || a.away < b.away),
  }
}

type Side = 'home' | 'away'
type Names = { home: string; away: string }

/**
 * A record's `names` (CLI 0.12.0: the names the hook's line uses), or null: a record without them is an older CLI's,
 * whose toast is its own `line` and for which neither `names` nor `lastGoal` is read.
 */
function namesOf(m: Item): Names | null {
  const n = m.names
  if (!isObject(n) || typeof n.home !== 'string' || typeof n.away !== 'string') return null
  if (n.home.trim() === '' || n.away.trim() === '') return null
  return { home: n.home, away: n.away }
}

/** The side the CLI says the saved pin is on, or null (no pin, or not a side). */
const pinnedSideOf = (m: Item): Side | null => (m.pinnedSide === 'home' || m.pinnedSide === 'away' ? m.pinnedSide : null)

const isMinute = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MINUTE_MAX

/** A record's `lastGoal` as the CLI proved it, or null for anything else (a player that is no name is left out). */
function lastGoalOf(v: unknown): ClaudinhoGoal | null {
  if (!isObject(v) || typeof v.type !== 'string' || !GOAL_TYPES.includes(v.type)) return null
  if ((v.side !== 'home' && v.side !== 'away') || !isMinute(v.minute)) return null
  if (v.added !== undefined && !(isMinute(v.added) && v.added > 0)) return null
  const player = typeof v.player === 'string' && v.player.trim() !== '' ? v.player : undefined
  return {
    type: v.type as ClaudinhoGoal['type'],
    minute: v.minute,
    ...(v.added !== undefined ? { added: v.added as number } : {}),
    side: v.side,
    ...(player !== undefined ? { player } : {}),
  }
}

/** Whether two `lastGoal` identities are the same goal: every field equal. */
const sameGoal = (a: ClaudinhoGoal, b: ClaudinhoGoal): boolean =>
  a.type === b.type && a.minute === b.minute && a.added === b.added && a.side === b.side && a.player === b.player

/** A goal's minute as a toast writes it: `22'`, `90+3'`. */
const goalMinute = (g: ClaudinhoGoal): string => (g.added ? `${g.minute}+${g.added}'` : `${g.minute}'`)

/** The record's clock minute, `60'`, or '' when it states none. */
const clockMinute = (m: Item): string => (isMinute(m.minute) ? `${m.minute}'` : '')

/** Words joined by one space, the empty ones left out. */
const words = (...ws: string[]): string => ws.filter((w) => w !== '').join(' ')

/** The scoreline a moment's toast writes: the names, the tally (a shootout tally after each side), or `vs`. */
function scoreline(names: Names, score: Tally | undefined, shootout: Tally | undefined): string {
  if (!score) return `${names.home} vs ${names.away}`
  const h = shootout ? `${score.home}(${shootout.home})` : `${score.home}`
  const a = shootout ? `${score.away}(${shootout.away})` : `${score.away}`
  return `${names.home} ${h}–${a} ${names.away}`
}

/** One moment of one record: its toast text, and the celebration's play when it has one. */
type Moment = { text: string; play: ClaudinhoPlay | null }

/**
 * The moment of a record that carries `names`, against its baseline entry, the first that holds: a compared tally that
 * fell (`Score updated`), a shootout tally that rose (`Penalties`; one that appears where the baseline had none counts
 * from 0), one regulation side up by exactly 1 (the goal), any other rise (`Goals`); none: null. A regulation tally is
 * compared only when both carry one. The goal names the side that rose; its scorer, the goal's minute and the own-goal
 * word only when `goal` (the record's `lastGoal`) is a new identity against the baseline's and on that side; otherwise
 * the record's clock minute. Against the pinned side it reads `Goal for` and plays nothing; else `⚽ GOAL!` (`⚽ Own
 * goal ·` for a proven own goal) and its play.
 */
function scoreMoment(m: Item, names: Names, was: ClaudinhoTally, goal: ClaudinhoGoal | null): Moment | null {
  const score = tally(m.score)
  const shootout = tally(m.shootout)
  const line = scoreline(names, score, shootout)
  const regulation: [Tally, Tally] | null = score && was.score ? [score, was.score] : null
  const shootWas = was.shootout ?? (shootout ? { home: 0, away: 0 } : undefined)
  const shoot: [Tally, Tally] | null = shootout && shootWas ? [shootout, shootWas] : null
  const pairs = [regulation, shoot].filter((p): p is [Tally, Tally] => p !== null)
  if (pairs.some(([a, b]) => a.home < b.home || a.away < b.away)) return { text: `Score updated\n${line}`, play: null }
  if (shoot && (shoot[0].home > shoot[1].home || shoot[0].away > shoot[1].away)) {
    return { text: `Penalties · ${line}`, play: null }
  }
  if (!regulation) return null
  const dh = regulation[0].home - regulation[1].home
  const da = regulation[0].away - regulation[1].away
  if (dh + da === 0) return null
  if (dh + da > 1) return { text: `Goals · ${line}`, play: null }
  const side: Side = dh === 1 ? 'home' : 'away'
  const team = names[side]
  const proven = goal !== null && goal.side === side && !(was.lastGoal && sameGoal(goal, was.lastGoal))
  const own = proven && goal.type === 'OWN_GOAL'
  const player = proven && !own ? (goal.player ?? '') : ''
  const minute = proven ? goalMinute(goal) : clockMinute(m)
  const pinned = pinnedSideOf(m)
  if (pinned !== null && pinned !== side) {
    const tail = own ? ` · ${words('own goal', minute)}` : player ? ` · ${words(player, minute)}` : minute ? ` ${minute}` : ''
    return { text: `Goal for ${team}${tail}\n${line}`, play: null }
  }
  const head = own ? `⚽ Own goal · ${words(team, minute)}` : player ? `⚽ GOAL! ${team} · ${words(player, minute)}` : `⚽ GOAL! ${words(team, minute)}`
  const detail = own ? words('own goal', minute) : player ? words(player, minute) : minute
  return { text: `${head}\n${line}`, play: { kind: 'goal', team, minute, detail } }
}

/** A side's code, when the record states one. */
const codeOf = (t: unknown): string | null => (isObject(t) && typeof t.code === 'string' && t.code !== '' ? t.code : null)

/**
 * The result of a finished record: a `winnerCode` first (the side whose code it is; a code that names neither side, or
 * both, establishes nothing), else the shootout (level: nothing), else the score (level: a draw); no score: nothing.
 * `winner` null is a draw.
 */
function resultOf(f: Item): { winner: Side | null } | null {
  if (typeof f.winnerCode === 'string' && f.winnerCode !== '') {
    const home = codeOf(f.home) === f.winnerCode
    const away = codeOf(f.away) === f.winnerCode
    return home !== away ? { winner: home ? 'home' : 'away' } : null
  }
  const shootout = tally(f.shootout)
  if (shootout) return shootout.home === shootout.away ? null : { winner: shootout.home > shootout.away ? 'home' : 'away' }
  const score = tally(f.score)
  if (!score) return null
  return { winner: score.home === score.away ? null : score.home > score.away ? 'home' : 'away' }
}

/**
 * The full-time moment of a finished record that carries `names`: `Full time ·` the scoreline, then the result
 * (`<team> win`, `Draw`) when it can be established; the play for the pinned side's win or draw.
 */
function fullTimeMoment(f: Item, names: Names): Moment {
  const line = scoreline(names, tally(f.score), tally(f.shootout))
  const result = resultOf(f)
  if (result === null) return { text: `Full time · ${line}`, play: null }
  const said = result.winner === null ? 'Draw' : `${names[result.winner]} win`
  const pinned = pinnedSideOf(f)
  const plays = pinned !== null && (result.winner === null || result.winner === pinned)
  return { text: `Full time · ${line}\n${said}`, play: plays ? { kind: 'fulltime', result: said } : null }
}

/**
 * One match's moments in a run: its id, its toasts in order, the plays its celebration would hold in order, and its
 * tallies in this view (each when present), the evidence a celebration keeps.
 */
type MatchMoments = { id: string; texts: string[]; plays: ClaudinhoPlay[]; score?: Tally; shootout?: Tally }

/** The view's finished records (CLI 0.12.0) that carry an id; none from an older CLI. */
function finishedOf(view: View): Item[] {
  const items = Array.isArray(view.finished) ? view.finished : []
  return items.filter((m): m is Item => isObject(m) && typeof m.id === 'string')
}

const evidence = (m: Item): { score?: Tally; shootout?: Tally } => {
  const score = tally(m.score)
  const shootout = tally(m.shootout)
  return { ...(score ? { score } : {}), ...(shootout ? { shootout } : {}) }
}

/**
 * The moments of a CURRENT view against the last current view's baseline, under the option (off: none; pinned: a record
 * with `pinned: true`; all: every match), one entry per match whose id the baseline holds, live records first, in the
 * view's order; a new id is the first observation (silent); a competition change rebases with nothing to compare.
 * - A live record without `names` (CLI 0.11.2): today's toast, `⚽` and its own `line`, when a compared tally changed
 *   (both carrying it); the banner play when one rose and none fell.
 * - A live record with `names`: its one moment (`scoreMoment`).
 * - A finished record with `names` whose id the baseline holds as live (it left `live` for `finished` between the two
 *   views): the goal moment when its tally rose in the same read (no `lastGoal` read: the clock minute), then full
 *   time. A finished record without `names`, or one also listed live, says nothing.
 */
function momentsFor(view: View, prev: ClaudinhoBaseline, option: ToastsOption): MatchMoments[] {
  if (option === 'off' || !prev || prev.slug !== slugOf(view)) return []
  const before = new Map(prev.items.map((t) => [t.id, t]))
  const out: MatchMoments[] = []
  const live = itemsOf(view)
  for (const m of live) {
    if (option === 'pinned' && m.pinned !== true) continue
    const was = before.get(m.id)
    if (!was) continue
    const names = namesOf(m)
    if (names === null) {
      if (typeof m.line !== 'string' || m.line === '') continue
      const { rose, fell } = movement(m, was)
      if (!rose && !fell) continue
      const text = `⚽ ${m.line}`
      out.push({ id: m.id, texts: [text], plays: rose && !fell ? [{ kind: 'banner', text }] : [], ...evidence(m) })
      continue
    }
    const moment = scoreMoment(m, names, was, lastGoalOf(m.lastGoal))
    if (moment === null) continue
    out.push({ id: m.id, texts: [moment.text], plays: moment.play ? [moment.play] : [], ...evidence(m) })
  }
  const liveIds = new Set(live.map((m) => m.id))
  for (const f of finishedOf(view)) {
    if (option === 'pinned' && f.pinned !== true) continue
    const was = before.get(f.id)
    if (!was || liveIds.has(f.id)) continue
    const names = namesOf(f)
    if (names === null) continue
    const goal = scoreMoment(f, names, was, null)
    const ft = fullTimeMoment(f, names)
    const moments = [goal, ft].filter((x): x is Moment => x !== null)
    out.push({
      id: f.id,
      texts: moments.map((x) => x.text),
      plays: moments.map((x) => x.play).filter((p): p is ClaudinhoPlay => p !== null),
      ...evidence(f),
    })
  }
  return out
}

/**
 * Whether this view says the celebrated goal's score is no longer the one it was decided on: the record's match
 * present (by its id, in the live list or else the finished list, before any `toasts` filter: a pin change never
 * hides it) with a tally DIFFERENT from the record's own (lower: a correction; higher: a later goal), a tally compared
 * only when both carry it. The baseline is not read, so a view in between without the match, or without its tally,
 * hides nothing. Absent or equal: no news.
 */
function differsFromRecord(view: View, rec: NonNullable<ClaudinhoCelebration>): boolean {
  const m = itemsOf(view).find((x) => x.id === rec.id) ?? finishedOf(view).find((x) => x.id === rec.id)
  if (!m) return false
  const score = tally(m.score)
  const shootout = tally(m.shootout)
  const differs = (a: Tally | undefined, b: Tally | undefined) => !!(a && b && (a.home !== b.home || a.away !== b.away))
  return differs(score, rec.score) || differs(shootout, rec.shootout)
}

/**
 * The baseline a CURRENT view leaves for the next one: its competition and each live match's tallies, with its
 * `lastGoal` identity when the record carries `names` and a `lastGoal`.
 */
function baselineOf(view: View): ClaudinhoBaseline {
  const items: ClaudinhoTally[] = itemsOf(view).map((m) => {
    const goal = namesOf(m) === null ? null : lastGoalOf(m.lastGoal)
    return { id: m.id, ...evidence(m), ...(goal ? { lastGoal: goal } : {}) }
  })
  return { slug: slugOf(view), items }
}

/**
 * The band's `lineParts` (CLI 0.12.0) when their texts join to the line exactly: each a text and, kept, the style
 * `strong` (another style is a plain part); at most 64. Anything else: none, and the band draws the plain line.
 */
function linePartsOf(view: View): Array<{ text: string; style?: 'strong' }> | null {
  const raw = view.lineParts
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LINE_PARTS_MAX) return null
  const parts: Array<{ text: string; style?: 'strong' }> = []
  for (const p of raw) {
    if (!isObject(p) || typeof p.text !== 'string') return null
    parts.push(p.style === 'strong' ? { text: p.text, style: 'strong' } : { text: p.text })
  }
  return parts.map((p) => p.text).join('') === view.line ? parts : null
}

/**
 * The match a `/claudinho match` binds, from the command's own reading: a view whose competition names a slug, its live
 * list's first record (the CLI lists the pick first), else its `next`; with the band's observation of that id in this
 * reading (whether it is listed, and its tallies). Nothing to bind: null.
 */
function bindingOf(reading: Reading): { slug: string; id: string; listed: boolean; score?: Tally; shootout?: Tally } | null {
  if (!reading.answered || !reading.isView) return null
  const { view } = reading
  const slug = slugOf(view)
  if (slug === '') return null
  const items = isObject(view.live) && Array.isArray(view.live.items) ? view.live.items : []
  const first: unknown = items[0]
  let id: string | null = null
  if (isObject(first) && typeof first.id === 'string' && first.id !== '') id = first.id
  else if (isObject(view.next) && typeof view.next.id === 'string' && view.next.id !== '') id = view.next.id
  if (id === null) return null
  return { slug, id, ...observe(view, id) }
}

/** What a view says of a match id: whether its live list holds it, and its tallies there (each when present). */
function observe(view: View, id: string): { listed: boolean; score?: Tally; shootout?: Tally } {
  const m = itemsOf(view).find((x) => x.id === id)
  if (!m) return { listed: false }
  const score = tally(m.score)
  const shootout = tally(m.shootout)
  return { listed: true, ...(score ? { score } : {}), ...(shootout ? { shootout } : {}) }
}

/**
 * Whether a CURRENT view of the bound competition is news about the bound match against the band's previous observation
 * of it: listed now and not before (kickoff), listed before and not now (full time), or a tally different (one that
 * appears is news; one that disappears is not). The observation is replaced either way: a change is consumed once.
 */
function paneNews(view: View): boolean {
  const b = bound
  if (b === null || b.final || observed === null || observed.gen !== b.gen || slugOf(view) !== b.slug) return false
  const was = observed
  const now = observe(view, b.id)
  observed = { gen: b.gen, ...now }
  if (now.listed !== was.listed) return true
  const differs = (a: Tally | undefined, prev: Tally | undefined) =>
    a !== undefined && (prev === undefined || a.home !== prev.home || a.away !== prev.away)
  return now.listed && (differs(now.score, was.score) || differs(now.shootout, was.shootout))
}

/** A string cut at `max` UTF-16 units, never ending in half a surrogate pair. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s
  const c = s.slice(0, max)
  const last = c.charCodeAt(c.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? c.slice(0, -1) : c
}

/** The Text props a pane part's style draws: strong bold, dim dimmed, accent and flair the goal colour, quote dimmed italic. */
function partStyle(style: ClaudinhoPanePart['style']): { bold?: true; dimColor?: true; italic?: true; color?: string } {
  if (style === 'strong') return { bold: true }
  if (style === 'dim') return { dimColor: true }
  if (style === 'accent' || style === 'flair') return { color: GOAL_COLOR }
  if (style === 'quote') return { dimColor: true, italic: true }
  return {}
}

/** One `match` read as the pane keeps it: the kind, the rows and footer, and the fields the re-reads decide by. */
type MatchRead = Omit<NonNullable<ClaudinhoPane>, 'gen' | 'slug' | 'id' | 'refreshFailed'>

/**
 * What one `claudinho match <id> --json` run said: `rows` (exit 0, not cut, the whole stdout ONE JSON value with
 * `lines` an array of strings), `noView` (one JSON value without such `lines`: a CLI before them), or `failed` (a run
 * that rejected, a non-zero exit, a cut stdout, not one JSON value). The fields a re-read decides by (`match.status`,
 * `match.kickoff`, whether `match` is null) are read from the value whatever its kind; never the text.
 */
function readMatch(r: RunResult | undefined): MatchRead {
  const failed: MatchRead = { kind: 'failed', lines: [], status: null, kickoff: null, final: false }
  if (!r || r.exitCode !== 0 || r.isStdoutTruncated === true) return failed
  let value: unknown
  try {
    value = JSON.parse(r.stdout.trim())
  } catch {
    return failed
  }
  const match = isObject(value) && isObject(value.match) ? value.match : null
  const status = match && STATUSES.includes(match.status as (typeof STATUSES)[number]) ? (match.status as string) : null
  const kickoff = match && typeof match.kickoff === 'string' && match.kickoff.length <= 64 ? match.kickoff : null
  const final = status !== null && FINAL_STATUSES.includes(status)
  const lines = isObject(value) ? value.lines : undefined
  if (!Array.isArray(lines) || !lines.every((l) => typeof l === 'string')) {
    return { kind: 'noView', lines: [], status, kickoff, final }
  }
  const attribution = relayed(isObject(value) ? value.attribution : undefined)
  const disclaimer = relayed(isObject(value) ? value.disclaimer : undefined)
  const rows = paneRowsOf(isObject(value) ? value.rows : undefined, lines as string[])
  return {
    kind: 'rows',
    lines: (lines as string[]).slice(0, PANE_LINES_MAX).map((l) => cut(l, PANE_LINE_CHARS)),
    ...(rows !== null ? { rows } : {}),
    ...(attribution !== null ? { attribution: cut(attribution, PANE_FOOTER_CHARS) } : {}),
    ...(disclaimer !== null ? { disclaimer: cut(disclaimer, PANE_FOOTER_CHARS) } : {}),
    status,
    kickoff,
    final,
  }
}

/**
 * The CLI's styled `rows` (CLI 0.12.0) when every row is `{ parts: [{ text, style? }] }` and the rows' parts join to
 * `lines`, index by index: at most 150 rows, each row's parts cut at 600 characters together and at 64 parts, a style
 * the plugin does not draw a plain part. Anything else: none, and the pane draws `lines` as before.
 */
function paneRowsOf(raw: unknown, lines: string[]): ClaudinhoPaneRow[] | null {
  if (!Array.isArray(raw) || raw.length !== lines.length) return null
  const rows: ClaudinhoPaneRow[] = []
  for (const [i, r] of raw.entries()) {
    if (!isObject(r) || !Array.isArray(r.parts)) return null
    const parts: ClaudinhoPanePart[] = []
    for (const p of r.parts) {
      if (!isObject(p) || typeof p.text !== 'string') return null
      parts.push(
        typeof p.style === 'string' && PANE_STYLES.includes(p.style)
          ? { text: p.text, style: p.style as ClaudinhoPanePart['style'] }
          : { text: p.text },
      )
    }
    if (parts.map((p) => p.text).join('') !== lines[i]) return null
    rows.push(parts)
  }
  return rows.slice(0, PANE_LINES_MAX).map((parts) => {
    const kept: ClaudinhoPanePart[] = []
    let room = PANE_LINE_CHARS
    for (const p of parts) {
      if (room <= 0 || kept.length >= PANE_ROW_PARTS_MAX) break
      if (p.text === '') continue
      const text = cut(p.text, room)
      room -= text.length
      if (text !== '') kept.push({ ...p, text })
      if (text.length < p.text.length) break
    }
    return kept
  })
}

/** One `match` run on the band's PATH, bounded, naming the competition once pinned; a rejection is undefined. */
async function spawnMatch(
  $: EngineInterface,
  b: Binding,
  env: { PATH: string } | undefined,
): Promise<RunResult | undefined> {
  try {
    return await $.process.run(['claudinho', 'match', b.id, '--json', ...(b.pinned ? ['--competition', b.slug] : [])], {
      timeoutMs: MATCH_TIMEOUT_MS,
      stdin: '',
      ...(env ? { env } : {}),
    })
  } catch {
    // No binary, a timeout, a refused spawn: a failed run.
    return undefined
  }
}

/**
 * Whether a run's answer is of another competition than the binding's: its stdout (not cut) one JSON value naming a
 * competition whose `slug` is another string (exit 0), or the CLI's first-run object (`competition: null`,
 * `noCompetition: true`: nothing chosen now, whatever the exit status). An answer with no `competition` key, or one
 * that is no JSON value, is no mismatch.
 */
function otherCompetition(r: RunResult | undefined, slug: string): boolean {
  if (!r || r.isStdoutTruncated === true) return false
  let value: unknown
  try {
    value = JSON.parse(r.stdout.trim())
  } catch {
    return false
  }
  if (!isObject(value)) return false
  if (value.competition === null && value.noCompetition === true) return true
  return (
    r.exitCode === 0 &&
    isObject(value.competition) &&
    typeof value.competition.slug === 'string' &&
    value.competition.slug !== slug
  )
}

/**
 * One read of the bound match. Unpinned, the run names no competition, so the CLI resolves the person's own choice and
 * its rows say where that choice came from; an answer of another competition (the person followed another since), or
 * of none, is never used: the binding is pinned for good and the read is made once more naming the bound competition,
 * whose answer is the read's.
 */
async function runMatch($: EngineInterface, b: Binding, env: { PATH: string } | undefined): Promise<MatchRead> {
  let result = await spawnMatch($, b, env)
  // Only for a binding still current: a pane closed or reopened while this read ran makes no second run.
  if (!b.pinned && bound === b && otherCompetition(result, b.slug)) {
    b.pinned = true
    result = await spawnMatch($, b, env)
  }
  return readMatch(result)
}

/** `fn` run after every read queued before it has settled; the queue's tail moves to it. */
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = readTail.then(fn)
  readTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function stopPaneTimers(): void {
  everyTimer?.cancel()
  everyTimer = null
  kickoffTimer?.cancel()
  kickoffTimer = null
}

/**
 * The re-read timers for the pane's value, for its binding: none once final; the kickoff timer alone while the last
 * answer is not in play (`LIVE`, `HT`) and its match's kickoff is ahead, degraded or not (no read before kickoff);
 * otherwise every 2 minutes: in play, failed, no match, a kickoff passed (a `SCHEDULED` that never turns polls until
 * the pane closes, as a stuck `LIVE` does), or a kickoff not readable.
 */
async function armPane($: EngineInterface, b: Binding, v: NonNullable<ClaudinhoPane>): Promise<void> {
  if (bound !== b) return
  const failed = v.kind === 'failed' || v.refreshFailed
  if (v.final && !failed) {
    stopPaneTimers()
    return
  }
  const inPlay = v.status === 'LIVE' || v.status === 'HT'
  const at = v.kickoff === null ? Number.NaN : Date.parse(v.kickoff)
  const now = await $.clock.now()
  if (bound !== b) return
  // A failed read carries no kickoff of its own (its kickoff is the last answer's), so a kickoff ahead decides alone.
  if (!inPlay && Number.isFinite(at) && at > now) {
    stopPaneTimers()
    kickoffTimer = $.clock.after(Math.min(at - now, TIMER_MAX_MS), () => {
      kickoffTimer = null
      reread($)
    })
    return
  }
  kickoffTimer?.cancel()
  kickoffTimer = null
  everyTimer ??= $.clock.every(PANE_EVERY_MS, () => {
    reread($)
  })
}

/** A pane read ended: a re-read asked during it is made now, when no other read is in flight. */
function paneReadEnded($: EngineInterface): void {
  paneReads -= 1
  if (paneReads === 0 && rereadPending) {
    rereadPending = false
    reread($)
  }
}

/**
 * A re-read of the bound match: none unbound or after a final answer; at most one read in flight (a trigger during one
 * is kept once). Its answer writes only while its binding is still the module's and the pane holds its generation: a
 * failed one keeps the last rows and says so above them; a good one replaces them. Never rejects.
 */
function reread($: EngineInterface): void {
  const b = bound
  if (b === null || b.final) return
  if (paneReads > 0) {
    rereadPending = true
    return
  }
  paneReads += 1
  void inTurn(async () => {
    const env = await runEnv($)
    const answer = await runMatch($, b, env)
    // The one check is inside the write, the latest point: a close or a reopen since this read began (the binding
    // replaced, the generation moved on) writes nothing.
    let written: NonNullable<ClaudinhoPane> | null = null
    await update($, pane, (cur) => {
      if (bound !== b || cur === null || cur.gen !== b.gen) return cur
      written =
        answer.kind === 'failed'
          ? { ...cur, refreshFailed: cur.kind !== 'failed' }
          : { gen: b.gen, slug: b.slug, id: b.id, refreshFailed: false, ...answer }
      return written
    })
    const wrote = written as NonNullable<ClaudinhoPane> | null
    if (wrote !== null) {
      b.final = wrote.final && !wrote.refreshFailed && wrote.kind !== 'failed'
      await armPane($, b, wrote)
    }
  })
    .catch(() => {
      // The engine's calls failed: the next trigger reads again.
    })
    .finally(() => paneReadEnded($))
}

/**
 * `/claudinho match`: binds the match of the command's reading under a new generation, writes the provisional value
 * (the view's line and footer) and opens the pane at once (inside the command's hook: an asked open, placed at any
 * width), then waits its turn, reads the match once, replaces the value with the answer and arms the re-reads.
 * Nothing to bind: no read, no pane. Resolves whether the pane opened and its first read's answer (CLI rows, with
 * their footer) was written to it; never rejects.
 */
async function openPane($: EngineInterface, reading: Reading, env: { PATH: string } | undefined): Promise<boolean> {
  const target = bindingOf(reading)
  if (target === null) return false
  let gen = 0
  await update($, paneGen, (g) => {
    gen = (typeof g === 'number' && Number.isFinite(g) ? g : 0) + 1
    return gen
  })
  const b: Binding = { gen, slug: target.slug, id: target.id, final: false, pinned: false }
  stopPaneTimers()
  rereadPending = false
  bound = b
  observed = {
    gen,
    listed: target.listed,
    ...(target.score ? { score: target.score } : {}),
    ...(target.shootout ? { shootout: target.shootout } : {}),
  }
  // The open counts as a read in flight from now until its own re-reads are armed: the read already in flight (whose
  // answer, its binding replaced, writes nothing) ending meanwhile fires no kept re-read beside the open's own.
  paneReads += 1
  try {
    // The pane opens at once, inside the command's hook (an open is the person's only within about 15 s of the
    // command, measured), showing the band's line and the view's footer until the CLI's rows land.
    const view = reading.answered ? reading.view : null
    const attribution = view === null ? null : relayed(view.attribution)
    const disclaimer = view === null ? null : relayed(view.disclaimer)
    const provisional: NonNullable<ClaudinhoPane> = {
      gen,
      slug: b.slug,
      id: b.id,
      kind: 'rows',
      lines: view === null ? [] : [cut(view.line, PANE_LINE_CHARS)],
      ...(attribution !== null ? { attribution: cut(attribution, PANE_FOOTER_CHARS) } : {}),
      ...(disclaimer !== null ? { disclaimer: cut(disclaimer, PANE_FOOTER_CHARS) } : {}),
      refreshFailed: false,
      status: null,
      kickoff: null,
      final: false,
    }
    let shown = false
    await update($, pane, (cur) => {
      shown = bound === b
      return shown ? provisional : cur
    })
    if (!shown || bound !== b) return false
    try {
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    } catch {
      // The open was refused: nothing shows it, so nothing reads it.
      if (bound === b) {
        bound = null
        stopPaneTimers()
      }
      return false
    }
    // Then its turn and its read; an open a later open superseded while it waited makes no run.
    const answer = await inTurn(async () => (bound === b ? runMatch($, b, env) : null))
    if (answer === null || bound !== b) return false
    const v: NonNullable<ClaudinhoPane> = { gen, slug: b.slug, id: b.id, refreshFailed: false, ...answer }
    let wrote = false
    await update($, pane, (cur) => {
      wrote = bound === b
      return wrote ? v : cur
    })
    if (!wrote || bound !== b) return false
    b.final = v.final
    await armPane($, b, v)
    return v.kind === 'rows'
  } finally {
    paneReadEnded($)
  }
}

/** The pane closed (by the person, or any close): a new generation, no value, no binding, no timers. */
async function closePane($: EngineInterface): Promise<void> {
  bound = null
  observed = null
  rereadPending = false
  stopPaneTimers()
  await update($, paneGen, (g) => (typeof g === 'number' && Number.isFinite(g) ? g : 0) + 1)
  await update($, pane, () => null)
}

/**
 * One run of the CLI, bounded; at most one in flight; paced by the last line unless `force`. A forced run asked while
 * one is in flight is kept (once) and made as soon as that run ends. No rejection escapes: a timer's callback calls it.
 */
function tick($: EngineInterface, option: ToastsOption, force = false): Promise<void> {
  if (busy) {
    if (force) forcedPending = true
    return Promise.resolve()
  }
  busy = true
  return run($, option, force)
    .catch(() => {
      // A run that failed in the engine's calls: nothing more to do until the next fire.
    })
    .finally(() => {
      busy = false
      if (forcedPending) {
        forcedPending = false
        void tick($, option, true)
      }
    })
}

async function run($: EngineInterface, option: ToastsOption, force: boolean): Promise<void> {
  // (1) No surface that draws the band (none yet, the last one detached, or the roster cannot be read): no process,
  // the band cleared, so a band surface attaching again never shows an old line, and the pace reset, so the next run
  // the roster allows is not held by an idle gap; the baseline and the context are left.
  if (!(await mayRun($))) {
    await clear($)
    return
  }
  // (2) On a non-idle line the timer is the only pace; the age check is the idle gap's alone.
  const now = await $.clock.now()
  const last = await read($, pace)
  if (!force && last.idle && now - last.ranAt < IDLE_MS) return
  // (3) The PATH, bounded.
  const env = await runEnv($)
  // (4) The roster again, the last await before the spawn: the surface may have left while the PATH was looked up.
  if (!(await mayRun($))) {
    await clear($)
    return
  }
  // (5) The spawn.
  const c = clears
  let result: RunResult | undefined
  try {
    result = await $.process.run(['claudinho', 'ambient', '--json', '--columns', String(columns)], {
      timeoutMs: RUN_TIMEOUT_MS,
      stdin: '',
      ...(env ? { env } : {}),
    })
  } catch {
    // No binary, a timeout, a refused spawn: a failed run.
  }
  const reading = readAnswer(result)
  if (!reading.answered) {
    // A failed run: nothing shown, the baseline and the context left, the next run at the next fire.
    if (clears === c) await update($, pace, () => ({ ranAt: now, idle: false }))
    await update($, band, (cur) => (clears === c ? null : cur))
    return
  }
  // The reading's facts (`readAnswer`): an object that is no view is hidden, never current (the context cleared, the
  // baseline kept, nothing toasted); an idle answer is read slowly.
  const { view, firstRun, isView, idle, hidden } = reading
  if (clears === c) await update($, pace, () => ({ ranAt: now, idle }))
  const parts = hidden ? null : linePartsOf(view)
  await update($, band, (cur) =>
    clears === c ? (hidden ? null : { text: view.line, ...(parts !== null ? { parts } : {}) }) : cur,
  )

  // The celebration's competition, first: a view (current or not) or the first-run object naming another competition
  // than the record's, or none (the first run's is ''), drops it and stops the redraws. The fallback object names no
  // competition and leaves it (the 60 s bound ends it); a failed run returned above.
  if (isView || firstRun) {
    const rec = await read($, celebration)
    if (rec !== null && slugOf(view) !== rec.slug) {
      stopTicker()
      await update($, celebration, (cur) => (cur !== null && cur.at === rec.at ? null : cur))
    }
  }

  // The two shapes that are no view are no current view either: each clears the context and keeps the baseline.
  if (isView && view.current === true) {
    const prev = await read($, baseline)
    const moments = momentsFor(view, prev, option)
    for (const m of moments) for (const text of m.texts) $.ui.toast(text)
    const played = celebrateOn ? moments.filter((m) => m.plays.length > 0) : []
    // What this view says of the celebration's match (its competition was asked above): its score differing from the
    // one the goal was decided on drops it (playing or waiting). The null stops the redraws too; a goal this run
    // decided is written after.
    const rec = await read($, celebration)
    if (rec !== null && differsFromRecord(view, rec)) {
      stopTicker()
      await update($, celebration, (cur) => (cur !== null && cur.at === rec.at ? null : cur))
    }
    await update($, baseline, () => baselineOf(view))
    // The celebration of the run's LAST match with a play, decided now: its first play, and full time's queued behind
    // a goal from the same read. The one clear-generation check is inside the write, the latest point: a clear since
    // the spawn (also while the clock is read) wins, and the run writes nothing.
    const goal = played[played.length - 1]
    const [first, ...queue] = goal?.plays ?? []
    if (goal !== undefined && first !== undefined) {
      const at = await $.clock.now()
      let wrote = false
      await update($, celebration, (cur) => {
        wrote = clears === c
        return wrote
          ? {
              ...first,
              at,
              slug: slugOf(view),
              id: goal.id,
              ...(goal.score ? { score: goal.score } : {}),
              ...(goal.shootout ? { shootout: goal.shootout } : {}),
              ...(queue.length > 0 ? { queue: queue.slice(0, 1) } : {}),
            }
          : cur
      })
      if (wrote) {
        playingAt = at
        playedMs = 0
        playFrom = holdTurn ? null : at
        lastPlayedAt = at
        if (holdTurn) stopTicker()
        else startTicker($)
      }
    }
    await update($, lastContext, () => ({
      context: typeof view.context === 'string' && view.context !== '' ? view.context : null,
      staleAfter: typeof view.staleAfter === 'string' ? view.staleAfter : null,
      ranAt: now,
    }))
    // The match pane's news: this current view against the band's previous observation of the bound match (its
    // competition only). The re-read runs on its own, never holding the band's run.
    if (paneNews(view)) reread($)
  } else {
    // A view that is not current, of any competition, says nothing about play: the context clears and the baseline
    // stays. Only a current view replaces it (a current view of another competition compares nothing and replaces
    // it; a disappearance rebases), so a change across the gap is said at the next current view, late, never lost
    // while the match stays in the list.
    await update($, lastContext, () => null)
  }
}

/**
 * Starts the pace once per module load: the first run right after the hook resolves (never inside it), then every 15
 * seconds. Returns whether it started it now.
 */
function ensurePace($: EngineInterface, option: ToastsOption): boolean {
  if (paced) return false
  paced = true
  $.clock.after(0, () => {
    void tick($, option, true)
  })
  $.clock.every(LIVE_MS, () => {
    void tick($, option)
  })
  return true
}

export const register: Register = (on, options) => {
  const option: ToastsOption = TOASTS_OPTIONS.includes(options.toasts as ToastsOption)
    ? (options.toasts as ToastsOption)
    : 'pinned'
  // Only the string `off` turns the celebration off.
  celebrateOn = options.celebrate !== 'off'
  // Only the string `off` turns the prompt context off.
  contextOn = options.context !== 'off'

  on('session.start', async ($, e, next) => {
    // `/claudinho` in every session, headless included: the person types it. A registration refused leaves the start
    // as it was.
    try {
      await $.command.register({ name: 'claudinho', description: COMMAND_DESCRIPTION })
    } catch {
      // No command this session; the band goes on.
    }
    // The start's own surface is not the question (the desktop app's is null, as `-p`'s): the roster is. A read that
    // rejects is unknown: the pace starts, and each run asks again.
    let start: boolean
    try {
      start = await drawable($)
    } catch {
      start = true
    }
    if (start) ensurePace($, option)
    return next(e)
  })

  on('session.attach', ($, e, next) => {
    // A band surface attached: the pace if it is not running, and a run at once either way.
    if (drawsBand(e.surface) && !ensurePace($, option)) {
      $.clock.after(0, () => {
        void tick($, option, true)
      })
    }
    return next(e)
  })

  on('session.detach', async ($, e, next) => {
    // The session is ending: nothing to do.
    if (e.reason === 'end') return next(e)
    // The client is already out of the roster here. The last band surface gone: the band cleared at once, so a quick
    // re-attach never shows an old line. No run and no timer started.
    const r = await next(e)
    if (!(await mayRun($))) await clear($)
    return r
  })

  on('turn.start', (_$, e, next) => {
    // A main-loop turn holds the celebration: paused at its last frame drawn, no redraws asked.
    holdTurn = true
    pausePlayback(Math.max(lastPlayedAt, playFrom ?? 0))
    stopTicker()
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    // Only the main loop's turn ends the hold (a subagent's turn ends with its `agentId`); the ticker again after the
    // hook returns, when there is still something to play.
    if (e.agentId === undefined) {
      holdTurn = false
      $.clock.after(0, () => {
        void resumeTicker($).catch(() => {
          // The engine's calls failed: no redraws are asked until the next goal or the next turn's end.
        })
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const width = e.props.bodyColumns
    if (typeof width === 'number' && Number.isInteger(width) && width > 0) columns = width
    const shown = await read($, band)
    const rec = celebrateOn ? await read($, celebration) : null
    const now = rec === null ? 0 : await $.clock.now()
    // (1) A survey holds the band, or there is no room: nothing of ours, as before; the celebration paused, no redraws.
    if (e.props.hasSurvey || e.props.maxRows < 1) {
      pausePlayback(now)
      stopTicker()
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    // The CLI fitted the line to the width asked, its `+N` suffix reserved; the engine's cut is the backstop. Its
    // `lineParts`, kept only when they join to the line, draw each `strong` part bold. A band beneath ours in the hook
    // chain (a plugin registered after ours, or the engine's own) stays, under our line.
    const lineRow =
      shown === null ? null : Array.isArray(shown.parts) ? (
        <Text wrap="truncate-end">
          {shown.parts.map((p, i) =>
            p.style === 'strong' ? (
              <Text key={`part-${i}`} bold>
                {p.text}
              </Text>
            ) : (
              <Text key={`part-${i}`}>{p.text}</Text>
            ),
          )}
        </Text>
      ) : (
        <Text wrap="truncate-end">{shown.text}</Text>
      )
    const withLine = async (above: RenderChildren[]) =>
      above.length === 0 && shown === null ? next(e) : (
        <Box flexDirection="column">
          {above}
          {lineRow}
          {await next(e)}
        </Box>
      )
    // (2) Nothing to play (no record, spent, or older than 60 s and not on screen): the band as before.
    if (rec === null || !playable(rec, now)) {
      if (rec !== null) stopTicker()
      return withLine([])
    }
    // (3) Held (a main-loop turn, or the drawn isWorking) or no room for a row: our line alone; the celebration paused,
    // no redraws.
    const rows = Math.min(3, e.props.maxRows - 2)
    const heldNow = holdTurn || e.props.isWorking === true
    if (heldNow || rows <= 0) {
      pausePlayback(now)
      stopTicker()
      return withLine([])
    }
    // (4) Playing: the play on screen and its frame from the time on screen, then our line (never an old one brought
    // back), then the band beneath.
    if (playFrom === null) playFrom = now
    lastPlayedAt = now
    // A pause no event ends (a survey, no room, a hold seen only in the drawn `isWorking`) stopped the redraws: the
    // playing draw starts them again.
    if (!ticker) startTicker($)
    let t = playedAt(now)
    let play: ClaudinhoPlay = rec
    for (const p of playsOf(rec)) {
      play = p
      if (t < playLength(p)) break
      t -= playLength(p)
    }
    const step = Math.floor(t / FRAME_MS)
    const frame = Math.min(FRAMES - 1, step)
    if (play.kind === 'goal' || play.kind === 'fulltime') {
      // The goal moments (a record that carries `names`): the mascot in three rows, else the words alone.
      const goalWord = (
        <Text key="goal-word" bold color={GOAL_COLOR}>
          GOAL!
        </Text>
      )
      let middle: RenderChildren
      let top: string
      let bottom: string
      if (play.kind === 'goal') {
        if (rows === 1) {
          return withLine([
            <Text key="row-0" wrap="truncate-end">
              {goalWord}
              {` ${words(play.team, play.minute)}`}
            </Text>,
          ])
        }
        middle = (
          <Text key="row-1" wrap="truncate-end">
            {goalWord}
            {` ${play.team}`}
          </Text>
        )
        if (rows === 2) {
          return withLine(
            play.detail === ''
              ? [middle]
              : [
                  middle,
                  <Text key="row-2" wrap="truncate-end">
                    {play.detail}
                  </Text>,
                ],
          )
        }
        top = ballRow(frame, Math.max(0, columns - MASCOT_COLUMNS - MASCOT_GAP))
        bottom = play.detail === '' ? ' ' : play.detail
      } else {
        middle = (
          <Text key="row-1" wrap="truncate-end">
            {`Full time · ${play.result}`}
          </Text>
        )
        if (rows < 3) return withLine([middle])
        top = ' '
        bottom = ' '
      }
      return withLine([
        <Box key="mascot">
          <Box flexDirection="column">
            <Text color={MASCOT_COLOR}>{MASCOT_HEAD}</Text>
            <Text color={MASCOT_COLOR}>{MASCOT_BODY}</Text>
            <Text color={MASCOT_COLOR}>{MASCOT_LEGS[step % 2]}</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={MASCOT_GAP}>
            <Text wrap="truncate-end">{top}</Text>
            {middle}
            <Text wrap="truncate-end">{bottom}</Text>
          </Box>
        </Box>,
      ])
    }
    // A record whose match carries no `names` (CLI 0.11.2): today's banner frames.
    const text = play.kind === 'banner' ? play.text : ''
    return withLine(
      celebrationRows(frame, rows, text, columns).map((row, i) => (
        <Text key={`row-${i}`} wrap="truncate-end">
          {row}
        </Text>
      )),
    )
  })

  on('command.run', { command: 'claudinho' }, async ($, e) => {
    // The command answers by itself (never `next`): one run on the band's PATH, the band's reading of the answer. No
    // `--columns` (the CLI's own 200-column ceiling, never the window's), none of the band's state touched. The text
    // typed after it is read for one word alone: `match` opens the pane; anything else is ignored. Neither call
    // rejects out of here: `runEnv` never rejects, and the spawn's rejection is a failed run.
    const env = await runEnv($)
    let result: RunResult | undefined
    try {
      result = await $.process.run(['claudinho', 'ambient', '--json'], {
        timeoutMs: RUN_TIMEOUT_MS,
        stdin: '',
        ...(env ? { env } : {}),
      })
    } catch {
      // No binary, a timeout, a refused spawn: no answer.
    }
    const reading = readAnswer(result)
    if (typeof e.args === 'string' && e.args.trim() === PANE_WORD) {
      // The pane: the match of this same reading, read and opened inside the hook. A pane that opened with the CLI's
      // rows, on a surface that draws it now, carries the attribution and the disclaimer: the reply is the line and a
      // short note. Otherwise (headless, nothing to bind, a first read that failed) the bare reply.
      let opened = false
      try {
        opened = await openPane($, reading, env)
      } catch {
        // The engine's calls failed: no pane this time; the reply stands.
      }
      if (opened && reading.answered && reading.isView && (await mayRun($))) {
        return { text: `${viewReply(reading.view, reading)}${PANE_OPEN_NOTE}` }
      }
    }
    return { text: replyTo(reading) }
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    // The pane closed: its re-reads stop and its generation moves on, so a read in flight from before writes nothing.
    try {
      await closePane($)
    } catch {
      // A state write failed: the binding and the timers are already gone.
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    // The pane draws its value alone: the CLI's rows verbatim, each wrapped (never cut sideways), then a blank row and
    // the footer dimmed; or one fixed sentence. Its size is the engine's (the body scrolls); no Button.
    const v = await read($, pane)
    if (v === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rows: Array<{ text: string; dim?: boolean; parts?: ClaudinhoPaneRow }> = []
    if (v.refreshFailed) rows.push({ text: PANE_REFRESH_FAILED })
    if (v.kind === 'failed') rows.push({ text: PANE_FAILED })
    else if (v.kind === 'noView') rows.push({ text: PANE_NO_VIEW })
    else {
      // The CLI's styled rows when it printed them (CLI 0.12.0), else its `lines` as before.
      if (Array.isArray(v.rows)) {
        for (const parts of v.rows) rows.push(parts.length === 0 ? { text: ' ' } : { text: '', parts })
      } else {
        for (const line of v.lines) rows.push({ text: line === '' ? ' ' : line })
      }
      const footer = [v.attribution, v.disclaimer].filter((s): s is string => typeof s === 'string')
      if (footer.length > 0) {
        rows.push({ text: ' ' })
        for (const s of footer) rows.push({ text: s, dim: true })
      }
    }
    return (
      <Box flexDirection="column">
        {rows.map((row, i) =>
          row.parts ? (
            <Text key={`row-${i}`} wrap="wrap">
              {row.parts.map((p, j) => (
                <Text key={`part-${j}`} {...partStyle(p.style)}>
                  {p.text}
                </Text>
              ))}
            </Text>
          ) : row.dim ? (
            <Text key={`row-${i}`} dimColor wrap="wrap">
              {row.text}
            </Text>
          ) : (
            <Text key={`row-${i}`} wrap="wrap">
              {row.text}
            </Text>
          ),
        )}
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    // The last current view's context, while that view is inside its own deadline and its run is recent. Never a
    // subprocess here: the timer's last run is the only source. Under `context: off`, nothing beside the prompt.
    if (!contextOn) return next(e)
    const record = await read($, lastContext)
    if (record?.context) {
      const now = await $.clock.now()
      const deadline = record.staleAfter === null ? Number.NaN : Date.parse(record.staleAfter)
      if (Number.isFinite(deadline) && now < deadline && now - record.ranAt < CONTEXT_MAX_AGE_MS) {
        return next({ ...e, context: [...(e.context ?? []), record.context] })
      }
    }
    return next(e)
  })
}
