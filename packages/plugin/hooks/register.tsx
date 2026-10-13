import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {
  ClaudinhoBand,
  ClaudinhoBaseline,
  ClaudinhoCelebration,
  ClaudinhoContext,
  ClaudinhoPace,
  ClaudinhoPane,
  ClaudinhoTally,
} from '../types'

/**
 * The claudinho plugin: the live score or the countdown above the prompt (the band), a toast when a score changes,
 * the live score beside the prompt for the model, `/claudinho`, the band's line on demand, and the match pane
 * (`/claudinho match`).
 *
 * The CLI owns the data (its cache, its refresher, the network, the backoff) and the words: the plugin never fetches.
 * This module runs the one binary, `claudinho ambient --json` (the band's runs add `--columns <the band's columns>`;
 * the pane runs `claudinho match <id> --json --competition <slug>`, whose read is the CLI's), with an argument array,
 * bounded, and reads the fields of the one JSON object it prints, never its text: what the line IS (`idle`, `empty`,
 * the first run's `noCompetition`), whether its list is `current`, and the hook's own line on each record, said
 * verbatim. No binary, a timeout, a cut or an answer that is not the object: the band shows nothing (the command says
 * so in one fixed sentence), never a blocked turn. Every run is also what
 * triggers the CLI's refresher, so the band runs at the live pace on every line but the idle ones. Best effort
 * throughout: a toast says a score change this module observed between two current views, never every goal.
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
 * It then runs `claudinho match <id> --json --competition <slug>` once (5 s, the whole stdout ONE JSON value), writes
 * the pane's value under a new generation (`paneGen`), and opens the pane `match` inside the hook (an asked open, placed
 * at any width); the reply is the bare one. The pane draws the CLI's `lines` verbatim (at most 150, each cut at 600
 * characters, each wrapped), a blank row, then the `attribution` and the `disclaimer` dimmed (each at 1,000), or one
 * fixed sentence: a first read that failed, or an answer with no `lines` (a CLI before them). While open it re-reads
 * the bound match: on a band run's CURRENT view of the bound competition that shows its score or shootout tally changed
 * from the band's previous observation (seeded by the open's reading; consumed once), or lists it newly (kickoff) or no
 * more (full time); at its kickoff while the last answer is `SCHEDULED`; every 2 minutes while the last answer is in
 * play (`LIVE`, `HT`), failed, or had no match. One read in flight at most (a trigger during one is kept once); a read
 * writes only under its generation; a failed re-read keeps the rows under a fixed row; none after a final answer (`FT`,
 * `POSTPONED`, `CANCELLED`) or once closed. The close (`ui.close` for `match`) moves the generation on and drops the
 * value, the binding and the timers. The binding and the timers are this module load's: after a reload the pane stays
 * drawn from its value and is re-read again from the next `/claudinho match`.
 *
 * The goal celebration: when a run's toasts include a GOAL (a regulation or shootout tally that rose, none that fell),
 * the band plays 6 frames over 3 seconds above its line (a ball crossing a row, a "GOAL" banner growing, then the
 * toast's own line), in at most min(3, maxRows - 2) rows, then goes back to its one line. Its record (`celebration`:
 * the last goal's toast line, when the run decided it, its competition, its match's id and that match's tallies the
 * goal was decided on) is written by the run and the clear alone: in a run, any answer naming another competition, or
 * none, current or not (a view, or the first-run object), nulls it, then its match's score changing from the record's own in any later current view (a correction, or a later goal the plugin did
 * not see as one; by the record's id, whatever the `toasts` filter) nulls it, then the run's last goal replaces it
 * under the band's clear generation; the existing clear nulls it. Every null also stops the redraws. A record another module
 * load wrote is never played (its `at` is not this load's), so a reload drops a waiting or playing celebration (the
 * toast already said it); it stays in state until a goal or a clear replaces it. A played or expired record stays
 * until the next goal replaces it: the draw ignores it. The draw only reads it, and
 * computes the frame from module values (how much of the 3 s has been on screen), redrawn by a 500 ms ticker that runs
 * only while there is something to play and no hold: a main-loop turn (`turn.start` to a `turn.complete` with no
 * `agentId`) or the drawn `isWorking` holds it, and it plays when the hold ends within 60 seconds of the goal. A
 * paused celebration never resumes after 60 seconds; a stretch on screen finishes its 3 seconds. `celebrate: off` plays
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
 * its competition and match id, and whether its last answer was final. Replaced by every open, nulled by the close: a
 * read whose binding is no longer this object writes nothing.
 */
type Binding = { gen: number; slug: string; id: string; final: boolean }
let bound: Binding | null = null
/** The band's previous observation of the bound id, under its generation: whether it was listed, and its tallies. */
type Observation = { gen: number; listed: boolean; score?: Tally; shootout?: Tally }
let observed: Observation | null = null
/** The pane's `match` reads in flight, and a re-read asked during one (kept once). */
let paneReads = 0
let rereadPending = false
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

/**
 * Whether a record has anything left to play at `now`: set, its 3 s not all on screen, and either within 60 s of its
 * goal or in a stretch on screen (which finishes its 3 s). A paused one never resumes after 60 s.
 */
const playable = (rec: ClaudinhoCelebration, now: number): boolean =>
  rec !== null &&
  rec.at === playingAt &&
  playedAt(now) < PLAY_MS &&
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
}

type Item = {
  id: string
  line?: unknown
  score?: unknown
  shootout?: unknown
  pinned?: unknown
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
  const text = reading.hidden ? REPLY_EMPTY : reading.idle ? REPLY_IDLE : reading.view.line
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

/**
 * One match whose compared tally changed: its id, its toast text, its tallies in this view (each when present), and
 * whether a side of a compared tally rose or fell.
 */
type ScoreChange = { id: string; text: string; score?: Tally; shootout?: Tally; rose: boolean; fell: boolean }

/**
 * The score changes of a CURRENT view against the last current view's baseline, under the option: one per match whose
 * id was there and whose regulation score or shootout tally changed (a tally compared only when both carry one), its
 * text `⚽` and the record's own line, verbatim (a record with no line says nothing). A new id is the first
 * observation (silent); a competition change rebases with nothing to compare.
 */
function scoreChanges(view: View, prev: ClaudinhoBaseline, option: ToastsOption): ScoreChange[] {
  if (option === 'off' || !prev || prev.slug !== slugOf(view)) return []
  const before = new Map(prev.items.map((t) => [t.id, t]))
  const changes: ScoreChange[] = []
  for (const m of itemsOf(view)) {
    if (option === 'pinned' && m.pinned !== true) continue
    const was = before.get(m.id)
    if (!was || typeof m.line !== 'string' || m.line === '') continue
    const { rose, fell } = movement(m, was)
    const score = tally(m.score)
    const shootout = tally(m.shootout)
    if (rose || fell) {
      changes.push({ id: m.id, text: `⚽ ${m.line}`, ...(score ? { score } : {}), ...(shootout ? { shootout } : {}), rose, fell })
    }
  }
  return changes
}

/** The toasts: every score change, a correction included. */
const toastsFor = (view: View, prev: ClaudinhoBaseline, option: ToastsOption): string[] =>
  scoreChanges(view, prev, option).map((c) => c.text)

/**
 * The goals among the toasts: a change whose compared tallies rose with none that fell (a correction is no goal), each
 * with the match's id and its tallies in this view, the evidence its celebration keeps.
 */
const goalsFor = (view: View, prev: ClaudinhoBaseline, option: ToastsOption): ScoreChange[] =>
  scoreChanges(view, prev, option).filter((c) => c.rose && !c.fell)

/**
 * Whether this view says the celebrated goal's score is no longer the one it was decided on: the record's match
 * present (by its id, before any `toasts` filter: a pin change never hides it) with a tally DIFFERENT from the
 * record's own (lower: a correction; higher: a later goal), a tally compared only when both carry it. The baseline
 * is not read, so a view in between without the match, or without its tally, hides nothing. Absent or equal: no news.
 */
function differsFromRecord(view: View, rec: NonNullable<ClaudinhoCelebration>): boolean {
  const m = itemsOf(view).find((x) => x.id === rec.id)
  if (!m) return false
  const score = tally(m.score)
  const shootout = tally(m.shootout)
  const differs = (a: Tally | undefined, b: Tally | undefined) => !!(a && b && (a.home !== b.home || a.away !== b.away))
  return differs(score, rec.score) || differs(shootout, rec.shootout)
}

/** The baseline a CURRENT view leaves for the next one: its competition and each match's tallies. */
function baselineOf(view: View): ClaudinhoBaseline {
  const items: ClaudinhoTally[] = itemsOf(view).map((m) => {
    const score = tally(m.score)
    const shootout = tally(m.shootout)
    return { id: m.id, ...(score ? { score } : {}), ...(shootout ? { shootout } : {}) }
  })
  return { slug: slugOf(view), items }
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
  return {
    kind: 'rows',
    lines: (lines as string[]).slice(0, PANE_LINES_MAX).map((l) => cut(l, PANE_LINE_CHARS)),
    ...(attribution !== null ? { attribution: cut(attribution, PANE_FOOTER_CHARS) } : {}),
    ...(disclaimer !== null ? { disclaimer: cut(disclaimer, PANE_FOOTER_CHARS) } : {}),
    status,
    kickoff,
    final,
  }
}

/** One `match` run for a binding, on the band's PATH, bounded; a rejection is a failed run. */
async function runMatch($: EngineInterface, b: Binding, env: { PATH: string } | undefined): Promise<MatchRead> {
  let result: RunResult | undefined
  try {
    result = await $.process.run(['claudinho', 'match', b.id, '--json', '--competition', b.slug], {
      timeoutMs: MATCH_TIMEOUT_MS,
      stdin: '',
      ...(env ? { env } : {}),
    })
  } catch {
    // No binary, a timeout, a refused spawn: a failed run.
  }
  return readMatch(result)
}

function stopPaneTimers(): void {
  everyTimer?.cancel()
  everyTimer = null
  kickoffTimer?.cancel()
  kickoffTimer = null
}

/**
 * The re-read timers for the pane's value, for its binding: none once final; at the kickoff while the last answer is
 * `SCHEDULED` (a kickoff not ahead arms nothing: the list triggers wait for it); every 2 minutes while the last answer
 * is in play, failed, or had no match; none on any other status.
 */
async function armPane($: EngineInterface, b: Binding, v: NonNullable<ClaudinhoPane>): Promise<void> {
  if (bound !== b) return
  const failed = v.kind === 'failed' || v.refreshFailed
  if (v.final && !failed) {
    stopPaneTimers()
    return
  }
  if (!failed && v.status === 'SCHEDULED') {
    everyTimer?.cancel()
    everyTimer = null
    kickoffTimer?.cancel()
    kickoffTimer = null
    const at = v.kickoff === null ? Number.NaN : Date.parse(v.kickoff)
    const now = await $.clock.now()
    if (bound === b && Number.isFinite(at) && at > now) {
      kickoffTimer = $.clock.after(Math.min(at - now, TIMER_MAX_MS), () => {
        kickoffTimer = null
        reread($)
      })
    }
    return
  }
  if (failed || v.status === null || v.status === 'LIVE' || v.status === 'HT') {
    kickoffTimer?.cancel()
    kickoffTimer = null
    everyTimer ??= $.clock.every(PANE_EVERY_MS, () => {
      reread($)
    })
    return
  }
  stopPaneTimers()
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
  void (async () => {
    const env = await runEnv($)
    const answer = await runMatch($, b, env)
    if (bound !== b) return
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
  })()
    .catch(() => {
      // The engine's calls failed: the next trigger reads again.
    })
    .finally(() => paneReadEnded($))
}

/**
 * `/claudinho match`: binds the match of the command's reading, reads it once, writes the pane's value under a new
 * generation, opens the pane (inside the command's hook: an asked open, placed at any width), then arms the re-reads.
 * Nothing to bind: no read, no pane. Never rejects.
 */
async function openPane($: EngineInterface, reading: Reading, env: { PATH: string } | undefined): Promise<void> {
  const target = bindingOf(reading)
  if (target === null) return
  let gen = 0
  await update($, paneGen, (g) => {
    gen = (typeof g === 'number' && Number.isFinite(g) ? g : 0) + 1
    return gen
  })
  const b: Binding = { gen, slug: target.slug, id: target.id, final: false }
  stopPaneTimers()
  rereadPending = false
  bound = b
  observed = {
    gen,
    listed: target.listed,
    ...(target.score ? { score: target.score } : {}),
    ...(target.shootout ? { shootout: target.shootout } : {}),
  }
  // The open's read counts as one in flight until its re-reads are armed: a trigger meanwhile is kept, made after.
  paneReads += 1
  try {
    const answer = await runMatch($, b, env)
    if (bound !== b) return
    const v: NonNullable<ClaudinhoPane> = { gen, slug: b.slug, id: b.id, refreshFailed: false, ...answer }
    let wrote = false
    await update($, pane, (cur) => {
      wrote = bound === b
      return wrote ? v : cur
    })
    if (!wrote || bound !== b) return
    b.final = v.final
    try {
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    } catch {
      // The open was refused: nothing shows it, so nothing re-reads it.
      if (bound === b) {
        bound = null
        stopPaneTimers()
      }
      return
    }
    await armPane($, b, v)
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
  await update($, band, (cur) => (clears === c ? (hidden ? null : { text: view.line }) : cur))

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
    for (const text of toastsFor(view, prev, option)) $.ui.toast(text)
    const goals = celebrateOn ? goalsFor(view, prev, option) : []
    // What this view says of the celebration's match (its competition was asked above): its score differing from the
    // one the goal was decided on drops it (playing or waiting). The null stops the redraws too; a goal this run
    // decided is written after.
    const rec = await read($, celebration)
    if (rec !== null && differsFromRecord(view, rec)) {
      stopTicker()
      await update($, celebration, (cur) => (cur !== null && cur.at === rec.at ? null : cur))
    }
    await update($, baseline, () => baselineOf(view))
    // The celebration of the run's LAST goal, decided now. The one clear-generation check is inside the write, the
    // latest point: a clear since the spawn (also while the clock is read) wins, and the run writes nothing.
    const goal = goals[goals.length - 1]
    if (goal !== undefined) {
      const at = await $.clock.now()
      let wrote = false
      await update($, celebration, (cur) => {
        wrote = clears === c
        return wrote
          ? {
              text: goal.text,
              at,
              slug: slugOf(view),
              id: goal.id,
              ...(goal.score ? { score: goal.score } : {}),
              ...(goal.shootout ? { shootout: goal.shootout } : {}),
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
    // The CLI fitted the line to the width asked, its `+N` suffix reserved; the engine's cut is the backstop. A band
    // beneath ours in the hook chain (a plugin registered after ours, or the engine's own) stays, under our line.
    const withLine = async (rows: string[]) =>
      rows.length === 0 && shown === null ? next(e) : (
        <Box flexDirection="column">
          {rows.map((row, i) => (
            <Text key={`row-${i}`} wrap="truncate-end">
              {row}
            </Text>
          ))}
          {shown === null ? null : <Text wrap="truncate-end">{shown.text}</Text>}
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
    // (4) Playing: the frame from the time on screen, then our line (never an old one brought back), then the band
    // beneath.
    if (playFrom === null) playFrom = now
    lastPlayedAt = now
    // A pause no event ends (a survey, no room, a hold seen only in the drawn `isWorking`) stopped the redraws: the
    // playing draw starts them again.
    if (!ticker) startTicker($)
    const frame = Math.min(FRAMES - 1, Math.floor(playedAt(now) / FRAME_MS))
    return withLine(celebrationRows(frame, rows, rec.text, columns))
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
      // The pane: the match of this same reading, read and opened inside the hook. The reply is the bare one either way.
      try {
        await openPane($, reading, env)
      } catch {
        // The engine's calls failed: no pane this time; the reply stands.
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
    const rows: Array<{ text: string; dim?: boolean }> = []
    if (v.refreshFailed) rows.push({ text: PANE_REFRESH_FAILED })
    if (v.kind === 'failed') rows.push({ text: PANE_FAILED })
    else if (v.kind === 'noView') rows.push({ text: PANE_NO_VIEW })
    else {
      for (const line of v.lines) rows.push({ text: line === '' ? ' ' : line })
      const footer = [v.attribution, v.disclaimer].filter((s): s is string => typeof s === 'string')
      if (footer.length > 0) {
        rows.push({ text: ' ' })
        for (const s of footer) rows.push({ text: s, dim: true })
      }
    }
    return (
      <Box flexDirection="column">
        {rows.map((row, i) =>
          row.dim ? (
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
    // subprocess here: the timer's last run is the only source.
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
