import { describe, expect, test } from 'claude-code/testing'
import { view, world } from './world'

/**
 * The toasts: a score change of a match whose id was in the last CURRENT view's list, said as `⚽` and the hook's
 * own line for it (which each record carries); the first observation of an id, a disappearance and a competition
 * change rebase the baseline silently; a view that is not current and a failed run leave it; `toasts` picks the
 * pinned matches (the default), all, or none.
 */
const match = (id: string, score: [number, number], over: Record<string, unknown> = {}) => ({
  id,
  stage: 'REGULAR',
  kickoff: '2026-10-10T14:00:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  score: { home: score[0], away: score[1] },
  minute: 60,
  status: 'LIVE',
  updatedAt: '2026-10-10T15:00:00.000Z',
  picked: true,
  pinned: true,
  // The hook's own line for the record, as the CLI prints it: the plugin says it and composes nothing.
  line: `Arsenal ${score[0]}–${score[1]} Chelsea (60')`,
  ...over,
})
const live = (items: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) =>
  view("⚽ ARS 2–1 CHE 60'", {
    live: { items, total: items.length, shown: items.length, truncated: false, complete: true },
    current: true,
    updatedAt: '2026-10-10T15:00:00.000Z',
    staleAfter: '2026-10-10T15:05:00.000Z',
    ...over,
  })

const toasted = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const texts: string[] = []
  on('ui.toast', (_$, e) => {
    texts.push(e.text)
    return { value: undefined } // the bottom answers as the engine does: a toast has no result
  })
  return texts
}

describe('a goal', () => {
  test("a score change of a pinned match between two current views is one toast with the hook's line", async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 0])]), live([match('1', [2, 0])])])
    expect(texts).toEqual([])
    await clock.advance(15_000)
    expect(texts).toEqual(["⚽ Arsenal 2–0 Chelsea (60')"])
  })

  test('the minute token follows the hook: half-time, and live with no minute', async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [0, 0])]), live([match('1', [1, 0], { status: 'HT', minute: undefined, line: 'Arsenal 1–0 Chelsea (half-time)' })]), live([match('1', [1, 1], { minute: undefined, line: 'Arsenal 1–1 Chelsea (live)' })])])
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(texts).toEqual(['⚽ Arsenal 1–0 Chelsea (half-time)', '⚽ Arsenal 1–1 Chelsea (live)'])
  })

  test("a shootout tally change is its own toast, with the hook's scoreline; an absent prior tally is never compared", async ($, on) => {
    const texts = toasted(on)
    const shootout = (h: number, a: number) => match('1', [1, 1], { stage: 'F', minute: 120, shootout: { home: h, away: a }, line: `Arsenal 1(${h})–1(${a}) Chelsea (120')` })
    const { clock } = await world($, on, [live([match('1', [1, 1], { stage: 'F', minute: 120, line: "Arsenal 1–1 Chelsea (120')" })]), live([shootout(1, 0)]), live([shootout(1, 1)])])
    await clock.advance(15_000)
    expect(texts).toEqual([]) // the tally appeared: nothing to compare it with
    await clock.advance(15_000)
    expect(texts).toEqual(["⚽ Arsenal 1(1)–1(1) Chelsea (120')"])
  })
})

describe('the line is the hook\'s, verbatim', () => {
  test('a nation match toasts the hook\'s line with its flags and roster names, which the plugin never composes', async ($, on) => {
    const texts = toasted(on)
    const nation = (score: [number, number]) => match('7', score, { home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' }, minute: 67, line: `🇲🇽 Mexico ${score[0]}–${score[1]} South Africa 🇿🇦 (67')` })
    const { clock } = await world($, on, [live([nation([0, 0])]), live([nation([1, 0])])])
    await clock.advance(15_000)
    expect(texts).toEqual(["⚽ 🇲🇽 Mexico 1–0 South Africa 🇿🇦 (67')"])
  })

  test('a regulation and a shootout change in one tick are one toast for the match', async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 1], { stage: 'F', minute: 120, shootout: { home: 2, away: 2 }, line: "Arsenal 1(2)–1(2) Chelsea (120')" })]), live([match('1', [2, 1], { stage: 'F', minute: 120, shootout: { home: 3, away: 2 }, line: "Arsenal 2(3)–1(2) Chelsea (120')" })])])
    await clock.advance(15_000)
    expect(texts).toEqual(["⚽ Arsenal 2(3)–1(2) Chelsea (120')"])
  })
})

describe('silence', () => {
  test('the first observation of an id, and an unchanged score', async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [2, 0])])])
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(texts).toEqual([])
  })

  for (const [why, over] of [['stale (not current)', { current: false }], ['degraded', { current: false, degraded: true }]] as const) {
    test(`a view that is not current never toasts and leaves the baseline: the next current view compares with the last current one (${why})`, async ($, on) => {
      const texts = toasted(on)
      const { clock } = await world($, on, [live([match('1', [1, 0])]), live([match('1', [2, 0])], over), live([match('1', [3, 0])])])
      await clock.advance(15_000)
      expect(texts).toEqual([]) // the non-current view says nothing about play
      await clock.advance(15_000)
      expect(texts).toEqual(["⚽ Arsenal 3–0 Chelsea (60')"]) // the goal across the gap is said, late, never lost
    })
  }

  test('a match that left the list and came back is observed afresh', async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 0])]), live([]), live([match('1', [2, 0])])])
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(texts).toEqual([])
  })

  test('a competition change observed through a view that is NOT current rebases too: a return to the first competition toasts nothing', { options: { toasts: 'all' } }, async ($, on) => {
    const texts = toasted(on)
    const other = { competition: { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'saved' } }
    const { clock } = await world($, on, [live([match('1', [1, 0])]), live([], { ...other, current: false }), live([match('1', [2, 0])])])
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(texts).toEqual([])
  })

  test('a competition change rebases', async ($, on) => {
    const texts = toasted(on)
    const other = { competition: { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'saved' } }
    const { clock } = await world($, on, [live([match('1', [1, 0])]), live([match('1', [2, 0])], other)])
    await clock.advance(15_000)
    expect(texts).toEqual([])
  })

  test('a failed run leaves the baseline: the next current view toasts against it', async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 0])]), new Error('timeout'), live([match('1', [2, 0])])])
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(texts).toEqual(["⚽ Arsenal 2–0 Chelsea (60')"])
  })
})

describe('the toasts option', () => {
  test("pinned (the default): a match that is not the pin's never toasts, and with no pin nothing does", async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 0], { pinned: false })]), live([match('1', [2, 0], { pinned: false })])])
    await clock.advance(15_000)
    expect(texts).toEqual([])
  })

  test('all: every match toasts', { options: { toasts: 'all' } }, async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 0], { pinned: false, picked: false })]), live([match('1', [2, 0], { pinned: false, picked: false })])])
    await clock.advance(15_000)
    expect(texts).toEqual(["⚽ Arsenal 2–0 Chelsea (60')"])
  })

  test('off: nothing toasts', { options: { toasts: 'off' } }, async ($, on) => {
    const texts = toasted(on)
    const { clock } = await world($, on, [live([match('1', [1, 0])]), live([match('1', [2, 0])])])
    await clock.advance(15_000)
    expect(texts).toEqual([])
  })
})
