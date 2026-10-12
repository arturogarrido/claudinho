import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClaudinhoBand, ClaudinhoBaseline, ClaudinhoContext, ClaudinhoPace, ClaudinhoTally } from '../types'

/**
 * The claudinho plugin: the live score or the countdown above the prompt (the band), a toast when a score changes,
 * the live score beside the prompt for the model, and `/claudinho`, the band's line on demand.
 *
 * The CLI owns the data (its cache, its refresher, the network, the backoff) and the words: this module runs the one
 * binary, `claudinho ambient --json` (the band's runs add `--columns <the band's columns>`), with an argument array,
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
 * or empty sentence) ends with the view's own disclaimer after a blank line, relayed from its `disclaimer` field,
 * never spelled here; a reply made from no view is its sentence alone. Its run is its own: whatever the roster says, it takes no part in the band's guard or pace, reads and writes no
 * `$.state` value, raises no toast and clears nothing; it shares only the kept PATH and nvm's lookup. Text typed after
 * the command is never read.
 */

const band = atom({ plugin: 'claudinho', key: 'band' } as const, null as ClaudinhoBand)
const pace = atom({ plugin: 'claudinho', key: 'pace' } as const, { ranAt: 0, idle: false } as ClaudinhoPace)
const baseline = atom({ plugin: 'claudinho', key: 'baseline' } as const, null as ClaudinhoBaseline)
const lastContext = atom({ plugin: 'claudinho', key: 'context' } as const, null as ClaudinhoContext)

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
  await update($, band, () => null)
  await update($, pace, () => ({ ranAt: 0, idle: false }))
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
  current?: unknown
  competition?: { slug?: unknown } | null
  staleAfter?: unknown
  disclaimer?: unknown
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

/**
 * The command's reply to a reading: the first that holds of a failed run, the first run, no view (each its sentence
 * alone), nothing known, the edition over; else the line. A reply made from a view ends with the view's disclaimer.
 */
function replyTo(reading: Reading): string {
  if (!reading.answered) return REPLY_FAILED
  if (reading.firstRun) return REPLY_FIRST_RUN
  if (!reading.isView) return REPLY_NO_VIEW
  const text = reading.hidden ? REPLY_EMPTY : reading.idle ? REPLY_IDLE : reading.view.line
  const disclaimer = reading.view.disclaimer
  // The CLI's own sentence, relayed (core's one constant); a view without a usable one answers its text alone.
  return typeof disclaimer === 'string' && disclaimer.trim() !== '' ? `${text}\n\n${disclaimer}` : text
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

/** Two tallies differ. */
const changed = (a: { home: number; away: number }, b: { home: number; away: number }) => a.home !== b.home || a.away !== b.away

/**
 * The toasts of a CURRENT view against the last current view's baseline, under the option: ONE toast per match whose
 * id was there and whose regulation score or shootout tally changed (a tally compared only when both carry one), its
 * text `⚽` and the record's own line, verbatim (a record with no line says nothing). A new id is the first
 * observation (silent); a competition change rebases with nothing to compare.
 */
function toastsFor(view: View, prev: ClaudinhoBaseline, option: ToastsOption): string[] {
  if (option === 'off' || !prev || prev.slug !== slugOf(view)) return []
  const before = new Map(prev.items.map((t) => [t.id, t]))
  const texts: string[] = []
  for (const m of itemsOf(view)) {
    if (option === 'pinned' && m.pinned !== true) continue
    const was = before.get(m.id)
    if (!was || typeof m.line !== 'string' || m.line === '') continue
    const score = tally(m.score)
    const shootout = tally(m.shootout)
    const regulation = !!(score && was.score && changed(score, was.score))
    const penalties = !!(shootout && was.shootout && changed(shootout, was.shootout))
    if (regulation || penalties) texts.push(`⚽ ${m.line}`)
  }
  return texts
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
  const { view, isView, idle, hidden } = reading
  if (clears === c) await update($, pace, () => ({ ranAt: now, idle }))
  await update($, band, (cur) => (clears === c ? (hidden ? null : { text: view.line }) : cur))

  // The two shapes that are no view are no current view either: each clears the context and keeps the baseline.
  if (isView && view.current === true) {
    const prev = await read($, baseline)
    for (const text of toastsFor(view, prev, option)) $.ui.toast(text)
    await update($, baseline, () => baselineOf(view))
    await update($, lastContext, () => ({
      context: typeof view.context === 'string' && view.context !== '' ? view.context : null,
      staleAfter: typeof view.staleAfter === 'string' ? view.staleAfter : null,
      ranAt: now,
    }))
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const width = e.props.bodyColumns
    if (typeof width === 'number' && Number.isInteger(width) && width > 0) columns = width
    const shown = await read($, band)
    if (e.props.hasSurvey || e.props.maxRows < 1 || shown === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The CLI fitted the line to the width asked, its `+N` suffix reserved; the engine's cut is the backstop. A band
    // beneath ours in the hook chain (a plugin registered after ours, or the engine's own) stays, under our line.
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">{shown.text}</Text>
        {await next(e)}
      </Box>
    )
  })

  on('command.run', { command: 'claudinho' }, async ($) => {
    // The command answers by itself (never `next`): one run on the band's PATH, the band's reading of the answer. No
    // `--columns` (the CLI's own 200-column ceiling, never the window's), the text typed after it never read, none of
    // the band's state touched. Neither call rejects out of here: `runEnv` never rejects, and the spawn's rejection is a failed run.
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
    return { text: replyTo(readAnswer(result)) }
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
