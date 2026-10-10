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

/**
 * What `claudinho ambient --json` prints, as far as this module reads it: a selected competition's VIEW (an object
 * with a `live` object holding an `items` array), or one of the two shapes that are no view: the first-run object
 * (no competition chosen: `noCompetition`, the one line) and the fallback object (a refused value or a failure: the
 * line and `empty`; an older CLI's `{ line }` has the same shape).
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

/** One run of the CLI, bounded; at most one in flight; paced by the last line unless `force`. */
function tick($: EngineInterface, option: ToastsOption, force = false): Promise<void> {
  if (busy) return Promise.resolve()
  busy = true
  return run($, option, force).finally(() => {
    busy = false
  })
}

async function run($: EngineInterface, option: ToastsOption, force: boolean): Promise<void> {
  const now = await $.clock.now()
  // On a non-idle line the timer is the only pace; the age check is the idle gap's alone.
  const last = await read($, pace)
  if (!force && last.idle && now - last.ranAt < IDLE_MS) return
  let answer: View | null = null
  try {
    const r = await $.process.run(['claudinho', 'ambient', '--json', '--columns', String(columns)], {
      timeoutMs: RUN_TIMEOUT_MS,
      stdin: '',
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
  // (nothing chosen) is hidden and idle; an object that is no view (the fallback object, an older CLI's `{ line }`)
  // is hidden and not idle; a view that says `empty` is hidden; one that says `idle` is read slowly.
  const firstRun = view.noCompetition === true
  const isView = !firstRun && isObject(view.live) && Array.isArray(view.live.items)
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
    // A view that is not current says nothing about play: no toast and no context. It keeps the baseline, which only
    // a current view replaces (and a disappearance rebases), so a change across the gap is said at the next current
    // view, late, never lost while the match stays in the list. A change of competition is observed whatever the
    // view's vouching: a view of another competition than the baseline's clears it (a view stating none, or the same
    // one, leaves it).
    const slug = isView ? slugOf(view) : ''
    if (slug !== '') {
      const prev = await read($, baseline)
      if (prev && prev.slug !== slug) await update($, baseline, () => null)
    }
    await update($, lastContext, () => null)
  }
}

export const register: Register = (on, options) => {
  const option: ToastsOption = TOASTS_OPTIONS.includes(options.toasts as ToastsOption)
    ? (options.toasts as ToastsOption)
    : 'pinned'

  on('session.start', ($, e, next) => {
    // A headless session (`-p`, the SDK) draws no band: no timer, no process.
    if (!e.isInteractive) return next(e)
    columns = DEFAULT_COLUMNS
    busy = false
    // The first run right after the start resolves (never inside it), then the pace.
    $.clock.after(0, () => {
      void tick($, option, true)
    })
    $.clock.every(LIVE_MS, () => {
      void tick($, option)
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const width = e.props.bodyColumns
    if (typeof width === 'number' && Number.isInteger(width) && width > 0) columns = width
    const shown = await read($, band)
    if (e.props.hasSurvey || e.props.maxRows < 1 || shown === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The CLI fitted the line to the width asked, its `+N` suffix reserved; the engine's cut is the backstop.
    return (
      <Box>
        <Text wrap="truncate-end">{shown.text}</Text>
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
