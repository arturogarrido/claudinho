import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClaudinhoBand, ClaudinhoBaseline, ClaudinhoContext, ClaudinhoPace, ClaudinhoTally } from '../types'

/**
 * The claudinho plugin: the live score or the countdown above the prompt (the band), a toast when a score changes,
 * and the live score beside the prompt for the model.
 *
 * The CLI owns the data (its cache, its refresher, the network, the backoff) and the words: this module runs the one
 * binary, `claudinho ambient --json --columns <the band's columns>`, with an argument array, bounded, and reads the
 * fields of the one JSON object it prints, never its text: what the line IS (`idle`, `empty`, the first run's
 * `noCompetition`), whether its list is `current`, and the hook's own line on each record, said verbatim. No binary,
 * a timeout, a cut or an answer that is not the object: silence, never a blocked turn. Every run is also what
 * triggers the CLI's refresher, so the band runs at the live pace on every line but the idle ones. Best effort
 * throughout: a toast says a score change this module observed between two current views, never every goal.
 *
 * It runs while a surface that draws the band is attached: the terminal or the desktop app, the two that raise
 * `AbovePrompt`, asked of the session's roster at every run, first and again as the last step before the spawn (the
 * desktop app's session starts with no surface and attaches after; a plugin loaded into an open desktop session hears
 * a start with no surface while the roster holds the desktop). A run that finds none attached (`claude -p`, the SDK, a
 * phone or an editor alone), or cannot read the roster, starts no process and clears the band. A roster read refused at
 * the start is unknown, so the pace starts and each run asks again: a read denied for good costs one read per 15
 * seconds and no process. Each run is handed a PATH: the host's own, then the folders npm, Homebrew, nvm, Volta, pnpm
 * and Bun install global commands into, so a session started with a bare PATH still finds the CLI and its `node` (on
 * Windows nothing is handed); nvm's part is looked up once, within one second. A band drawn beneath ours in the hook
 * chain (a plugin registered after ours, or the engine's own) stays, under our line: we never drop it.
 */

const band = atom({ plugin: 'claudinho', key: 'band' } as const, null as ClaudinhoBand)
const pace = atom({ plugin: 'claudinho', key: 'pace' } as const, { ranAt: 0, idle: false } as ClaudinhoPace)
const baseline = atom({ plugin: 'claudinho', key: 'baseline' } as const, null as ClaudinhoBaseline)
const lastContext = atom({ plugin: 'claudinho', key: 'context' } as const, null as ClaudinhoContext)

const LIVE_MS = 15_000
const IDLE_MS = 300_000
const RUN_TIMEOUT_MS = 2_000
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
/** At most one run in flight: the guard is taken before the first await. */
let busy = false
/** A forced run asked while a run was in flight: made as soon as that run ends (cleared when it starts). */
let forcedPending = false
/**
 * The pace (the forced first run, then every 15 seconds) is started once per module load, by whichever comes first of
 * a start or an attach of a band surface. A reload makes a fresh module and drops the previous one's timers.
 */
let paced = false
/** The `env` every run is handed, computed once per module load on the first run (undefined: none, on Windows). */
let runEnvOnce: Promise<{ PATH: string } | undefined> | null = null

/** The two surfaces that raise `AbovePrompt`. */
const drawsBand = (surface: unknown): boolean => surface === 'terminal' || surface === 'desktop'

/** Whether a surface that draws the band is attached to the session now (a read that rejects is the caller's to read). */
const drawable = async ($: EngineInterface): Promise<boolean> => (await $.session.surfaces()).some(drawsBand)

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
/** The one deadline over nvm's whole lookup (the listing, the sort and the probes). */
const NVM_DEADLINE_MS = 1_000
/** The listing's entries read, before any per-entry work. */
const NVM_ENTRIES_MAX = 256
/** The version folders kept, the newest by number. */
const NVM_VERSIONS_MAX = 8

/**
 * nvm's version folders' `bin`, of the first 256 entries the listing gives, at most the 8 newest by number: those whose
 * `bin/claudinho` exists first, then the rest, each newest first; none when the folder cannot be listed, and none once
 * `expired()` (nothing is probed after the deadline).
 */
async function nvmLookup($: EngineInterface, home: string, expired: () => boolean): Promise<string[]> {
  const root = `${home}/.nvm/versions/node`
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(root)
  } catch {
    return []
  }
  if (expired()) return []
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

/** nvm's part of the PATH, bounded: past one second (or a deadline that cannot be kept), none for this module load. */
async function nvmBins($: EngineInterface, home: string): Promise<string[]> {
  let expired = false
  const stop = new AbortController()
  const deadline = $.clock.sleep(NVM_DEADLINE_MS, { signal: stop.signal }).then(
    () => {
      expired = true
      return [] as string[]
    },
    () => {
      expired = true
      return [] as string[]
    },
  )
  const lookup = nvmLookup($, home, () => expired)
  const bins = await Promise.race([lookup, deadline])
  if (!expired) stop.abort()
  return bins
}

/**
 * The `env` a run is handed: none on Windows; else `PATH` = the host's PATH, then (under a HOME) nvm's version folders
 * and the user-level global-bin folders, then the system ones; each folder once, its first place kept, so the host's
 * order wins. Never rejects.
 */
async function computeRunEnv($: EngineInterface): Promise<{ PATH: string } | undefined> {
  if ((await orUnset(() => $.env.get('OS'))) === 'Windows_NT') return undefined
  const folders: string[] = []
  const host = await orUnset(() => $.env.get('PATH'))
  if (host) folders.push(...host.split(':').filter((s) => s !== ''))
  // A folder under HOME only when HOME is an absolute path that holds no PATH separator.
  const home = await orUnset(() => $.env.get('HOME'))
  if (home?.startsWith('/') && !home.includes(':')) {
    folders.push(...(await nvmBins($, home)))
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
  return { PATH: [...new Set(folders)].join(':') }
}

function runEnv($: EngineInterface): Promise<{ PATH: string } | undefined> {
  runEnvOnce ??= computeRunEnv($)
  return runEnvOnce
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
  // and the band cleared, so a band surface attaching again never shows an old line; the pace, the baseline and the
  // context are left.
  if (!(await mayRun($))) {
    await update($, band, () => null)
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
    await update($, band, () => null)
    return
  }
  // (5) The spawn.
  let answer: View | null = null
  try {
    const r = await $.process.run(['claudinho', 'ambient', '--json', '--columns', String(columns)], {
      timeoutMs: RUN_TIMEOUT_MS,
      stdin: '',
      ...(env ? { env } : {}),
    })
    // A cut stdout is no answer: its first line may be part of an object.
    if (r.exitCode === 0 && r.isStdoutTruncated !== true) answer = parseView(r.stdout)
  } catch {
    // No binary, a timeout, a refused spawn: a failed run.
  }
  if (!answer) {
    // A failed run: nothing shown, the baseline and the context left, the next run at the next fire.
    await update($, pace, () => ({ ranAt: now, idle: false }))
    await update($, band, () => null)
    return
  }
  const view: View = answer
  // What the line IS comes from the fields, never the text (which `--columns` may have cut): the first-run object
  // (nothing chosen) is hidden and idle; an object that is no view the plugin reads is hidden and not idle, never
  // current (the context cleared, the baseline kept, nothing toasted); a view that says `empty` is hidden; one that
  // says `idle` is read slowly. A view the plugin reads has its `live` list AND says what its line is, `idle` and
  // `empty` as two booleans: the fallback object, an older CLI's `{ line }`, and a view from a CLI older than those
  // two fields (a live list and neither) are no view.
  const firstRun = view.noCompetition === true
  const isView =
    !firstRun &&
    isObject(view.live) &&
    Array.isArray(view.live.items) &&
    typeof view.idle === 'boolean' &&
    typeof view.empty === 'boolean'
  const idle = firstRun || (isView && view.idle === true)
  const hidden = !isView || view.empty === true || view.line.trim() === ''
  await update($, pace, () => ({ ranAt: now, idle }))
  await update($, band, () => (hidden ? null : { text: view.line }))

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
