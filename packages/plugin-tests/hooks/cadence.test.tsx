import { describe, expect, test } from 'claude-code/testing'
import { COMPLETE, FIRST_RUN, NOW, liveRecord, finishedRecord, momentView, view, world } from './world'

/**
 * The band's pace (plugin 0.7.0): after each band run the module asks the host for ONE timer, sized from that run's
 * reading (its fields, never the line's text): 15 s while a match is listed live or finished (the full-time window),
 * from 2 minutes before the next kickoff (a due kickoff included) and on the syncing line; every minute inside the hour
 * before kickoff, after a run that gave no answer, on nothing known (`empty`) and on an object that is no view; every 5
 * minutes when the next kickoff is more than an hour away; 5 minutes on the sign-off and the first run (unchanged).
 * Inside a phase the wait is cut at the next phase's start (min of the pace and the time to the boundary), never below
 * 15 s. Each case pins the wait by the clock: no run one millisecond before it, one run at it.
 */
const MIN = 60_000
const at = (ms: number) => new Date(NOW + ms).toISOString()
/** A countdown view: the next fixture's kickoff `ms` after the clock's start (the first run's clock). */
const countdown = (ms: number, over: Record<string, unknown> = {}) =>
  view('⚽ ARS vs LEE in 7h13m', { next: { id: '9', kickoff: at(ms), status: 'SCHEDULED' }, ...over })

type W = Awaited<ReturnType<typeof world>>

/** The next band run comes exactly `d` after the last one: none at `d - 1`, one at `d`. */
const nextRunAfter = async (w: W, d: number) => {
  const last = w.runTimes.at(-1) as number
  const n = w.runTimes.length
  await w.clock.set(last + d - 1)
  expect(w.runTimes.length, `no run before ${d} ms`).toBe(n)
  await w.clock.set(last + d)
  expect(w.runTimes.length, `one run at ${d} ms`).toBe(n + 1)
  expect(w.runTimes.at(-1)).toBe(last + d)
}

describe('the pace by phase', () => {
  test('the next kickoff 10 days away: every 5 minutes', async ($, on) => {
    const w = await world($, on, [countdown(10 * 24 * 60 * MIN)])
    await nextRunAfter(w, 5 * MIN)
    await nextRunAfter(w, 5 * MIN)
  })

  test('63 minutes away: the next run at the hour boundary (3 minutes), then every minute', async ($, on) => {
    const w = await world($, on, [countdown(63 * MIN)])
    await nextRunAfter(w, 3 * MIN)
    await nextRunAfter(w, MIN)
    await nextRunAfter(w, MIN)
  })

  test('30 minutes away: every minute', async ($, on) => {
    const w = await world($, on, [countdown(30 * MIN)])
    await nextRunAfter(w, MIN)
  })

  test('2 minutes 40 seconds away: the next run at the 2-minute boundary (40 s), then every 15 s', async ($, on) => {
    const w = await world($, on, [countdown(2 * MIN + 40_000)])
    await nextRunAfter(w, 40_000)
    await nextRunAfter(w, 15_000)
  })

  test('2 minutes 5 seconds away: never sooner than 15 s', async ($, on) => {
    const w = await world($, on, [countdown(2 * MIN + 5_000)])
    await nextRunAfter(w, 15_000)
  })

  test('61 minutes away: never sooner than 15 s at the hour boundary either', async ($, on) => {
    const w = await world($, on, [countdown(60 * MIN + 5_000)])
    await nextRunAfter(w, 15_000)
  })

  test('a kickoff the feed has not marked live yet (due, 5 minutes past): every 15 s', async ($, on) => {
    const w = await world($, on, [countdown(-5 * MIN)])
    await nextRunAfter(w, 15_000)
  })

  test('a match in the live list: every 15 s', async ($, on) => {
    const w = await world($, on, [momentView([liveRecord([0, 1])], [], { next: { id: '9', kickoff: at(5 * 24 * 60 * MIN) } })])
    await nextRunAfter(w, 15_000)
    await nextRunAfter(w, 15_000)
  })

  test('a match just finished (its full-time window): every 15 s, whatever the next kickoff', async ($, on) => {
    const w = await world($, on, [momentView([], [finishedRecord([0, 1])], { next: { id: '9', kickoff: at(5 * 24 * 60 * MIN) } })])
    await nextRunAfter(w, 15_000)
  })

  test('the syncing line (not empty, not idle, nothing live, no next fixture): every 15 s', async ($, on) => {
    const w = await world($, on, [view('⚽ live · syncing…')])
    await nextRunAfter(w, 15_000)
  })

  test('nothing known (`empty`): every minute', async ($, on) => {
    const w = await world($, on, [view('⚽ —', { empty: true })])
    await nextRunAfter(w, MIN)
    await nextRunAfter(w, MIN)
  })

  test('a run that gave no answer (rejected): every minute', async ($, on) => {
    const w = await world($, on, [new Error('timeout')], { bins: ['/usr/bin/claudinho'] })
    await nextRunAfter(w, MIN)
    await nextRunAfter(w, MIN)
  })

  test('a run that exited non-zero: every minute', async ($, on) => {
    const w = await world($, on, [{ stdout: 'error', exitCode: 1 }])
    await nextRunAfter(w, MIN)
  })

  test('an answer that is no JSON: every minute', async ($, on) => {
    const w = await world($, on, ['not json at all'])
    await nextRunAfter(w, MIN)
  })

  test('an object that is no view (the fallback object): every minute', async ($, on) => {
    const w = await world($, on, [JSON.stringify({ line: '⚽ —', empty: true })])
    await nextRunAfter(w, MIN)
  })

  test('a next fixture whose kickoff cannot be read: every minute', async ($, on) => {
    const w = await world($, on, [view('⚽ ARS vs LEE soon', { next: { id: '9', kickoff: 'soon' } })])
    await nextRunAfter(w, MIN)
  })

  test('the sign-off (`idle`): every 5 minutes', async ($, on) => {
    const w = await world($, on, [view(COMPLETE, { idle: true })])
    await nextRunAfter(w, 5 * MIN)
  })

  test('the first-run object (nothing chosen): every 5 minutes', async ($, on) => {
    const w = await world($, on, [FIRST_RUN])
    await nextRunAfter(w, 5 * MIN)
  })

  test('the pace follows each run: a countdown, then a live match, then nothing known', async ($, on) => {
    const w = await world($, on, [countdown(10 * 24 * 60 * MIN), momentView([liveRecord([0, 0])]), view('⚽ —', { empty: true })])
    await nextRunAfter(w, 5 * MIN)
    await nextRunAfter(w, 15_000)
    await nextRunAfter(w, MIN)
  })
})

describe('one timer at a time', () => {
  test('failed runs never stack timers: one run per minute over ten minutes', async ($, on) => {
    const w = await world($, on, [new Error('timeout')], { bins: ['/usr/bin/claudinho'] })
    await w.clock.advance(10 * MIN)
    expect(w.runTimes.map((t) => t - (w.runTimes[0] as number))).toEqual(Array.from({ length: 11 }, (_, i) => i * MIN))
  })

  test('a run whose state write is refused (it throws) still arms the next run, a minute on, and one only', async ($, on) => {
    const at = { deny: false }
    on('state.set', (_$, e, next) => (at.deny && e.key === 'band' ? { deny: 'state write refused' } : next(e)))
    const w = await world($, on, [view('⚽ live · syncing…')])
    at.deny = true
    await nextRunAfter(w, 15_000)
    at.deny = false
    await nextRunAfter(w, MIN)
    await nextRunAfter(w, 15_000)
  })

  test('a toast the host refuses does not stop the pace', async ($, on) => {
    on('ui.toast', () => ({ deny: 'toasts refused' }))
    const w = await world($, on, [momentView([liveRecord([0, 0])]), momentView([liveRecord([0, 1])]), momentView([liveRecord([0, 1])])])
    await nextRunAfter(w, 15_000)
    await nextRunAfter(w, 15_000)
  })

  test('an attach (a forced run) replaces the armed timer: runs at 0, at the attach, and 5 minutes after it', async ($, on) => {
    const w = await world($, on, [countdown(10 * 24 * 60 * MIN)])
    const first = w.runTimes[0] as number
    await w.clock.set(first + 100_000)
    await w.attach('desktop', 'app')
    const forced = w.runTimes.at(-1) as number
    await w.clock.set(first + 10 * MIN)
    expect(w.runTimes.map((t) => t - first)).toEqual([0, forced - first, forced - first + 5 * MIN])
  })

  test('a slash command runs the CLI once and arms no band timer', async ($, on) => {
    const w = await world($, on, [countdown(10 * 24 * 60 * MIN)])
    const first = w.runTimes[0] as number
    await w.clock.set(first + 100_000)
    await w.command()
    await w.clock.set(first + 10 * MIN)
    expect(w.runTimes.map((t) => t - first)).toEqual([0, 100_000, 5 * MIN, 10 * MIN])
  })

  test('the band surface gone: the timer asks only the roster, every 15 s, and starts no process', async ($, on) => {
    const w = await world($, on, [countdown(10 * 24 * 60 * MIN)], { start: { surface: null, isInteractive: false }, surfaces: ['desktop'] })
    await w.detach('desktop')
    await w.clock.advance(5 * MIN)
    const reads = w.rosterReads()
    await w.clock.advance(15_000)
    expect(w.rosterReads()).toBeGreaterThan(reads)
    expect(w.argvs).toHaveLength(1)
  })
})
