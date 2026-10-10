import { describe, expect, test } from 'claude-code/testing'
import { COMPLETE, FIRST_RUN, view, world } from './world'

/**
 * The band: `claudinho ambient --json --columns <the band's columns>` every 15 s, the object's `line` shown as the
 * CLI fitted it. Hidden: the first-run line and `⚽ —`; shown: a score, a countdown, the complete line. The two
 * idle lines are read every five minutes; a failed run, a missing binary, a non-object or a headless session show
 * nothing and block nothing.
 */
describe('what the band runs', () => {
  test("the CLI once at the start, ambient --json fitted to the band's columns, with an empty stdin", async ($, on) => {
    const { argvs, stdins } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")])
    expect(argvs).toEqual([['claudinho', 'ambient', '--json', '--columns', '80']])
    expect(stdins).toEqual([''])
  })

  test("the columns are the band's: a narrower band asks for a narrower line on the next run", async ($, on) => {
    const { argvs, clock, mount } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")])
    await mount({ bodyColumns: 24 })
    await clock.advance(15_000)
    expect(argvs.at(-1)).toEqual(['claudinho', 'ambient', '--json', '--columns', '24'])
  })
})

describe('what the band shows', () => {
  for (const [line, over] of [["⚽ ARS 2–1 CHE 50'", {}], ['⚽ ARS 0–0 CHE LIVE', {}], ['⚽ ARS 0–0 CHE live · syncing…', {}], ['ARS vs LEE in 7h13m', {}], [COMPLETE, { idle: true }], ['⚽ World Cup 2026 is co…', { idle: true }]] as const) {
    test(`shows the line as the CLI fitted it: ${line}`, async ($, on) => {
      const { mount } = await world($, on, [view(line, over)])
      expect(await (await mount()).findAll({ type: 'Text', text: line })).toHaveLength(1)
    })
  }

  test('shows nothing on the first-run object (no competition chosen: its own key, no view)', async ($, on) => {
    const { mount } = await world($, on, [FIRST_RUN])
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })

  for (const [why, line] of [['nothing known', '⚽ —'], ['nothing known, the dash another character', '⚽ -'], ['nothing known, whatever the text says', "⚽ ARS 2–1 CHE 50'"]] as const) {
    test(`shows nothing when the view says empty: ${why}`, async ($, on) => {
      const { mount } = await world($, on, [view(line, { empty: true })])
      expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    })
  }

  for (const [why, answer] of [["the CLI's fallback object (a refused value, a throw before the view): it says empty", '{"line":"⚽ —","empty":true}'], ['an older CLI\'s line-only object: not a view (no live list), hidden whatever its line', '{"line":"⚽ —"}'], ['a line-only object with a score-like line: still not a view', '{"line":"⚽ ARS 2–1 CHE 50\'"}']] as const) {
    test(`shows nothing on ${why}`, async ($, on) => {
      const { mount } = await world($, on, [answer])
      expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    })
  }

  test('a CLI older than the fields: a view with a live list and neither `idle` nor `empty` is no view the plugin reads, hidden whatever its line', async ($, on) => {
    const older = JSON.stringify({ line: "⚽ ARS 2–1 CHE 50'", context: null, live: { items: [{ id: '1', status: 'LIVE', score: { home: 2, away: 1 } }], total: 1, shown: 1, truncated: false, complete: true }, current: true, next: null, pick: null, competition: { slug: 'eng.1' }, degraded: false, source: 'espn', updatedAt: '2026-10-10T15:00:00.000Z', staleAfter: '2026-10-10T15:05:00.000Z' })
    const { mount } = await world($, on, [older])
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('the text alone decides nothing: a line that reads like the first-run line, with the view saying it is neither empty nor idle, is shown', async ($, on) => {
    const { mount } = await world($, on, [view('⚽ claudinho follow')])
    expect(await (await mount()).findAll({ type: 'Text', text: '⚽ claudinho follow' })).toHaveLength(1)
  })

  for (const [why, answer] of [['a line that is not an object', "⚽ ARS 2–1 CHE 50'"], ['an empty answer', ''], ['an object with no line', '{"current":false}']] as const) {
    test(`shows nothing on ${why}`, async ($, on) => {
      const { mount } = await world($, on, [answer])
      expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    })
  }

  test('a truncated stdout is a failed run: nothing shown', async ($, on) => {
    const { mount } = await world($, on, [{ stdout: view("⚽ ARS 2–1 CHE 50'"), truncated: true }])
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('shows nothing when the binary cannot run, and runs again at the next fire', async ($, on) => {
    const { argvs, clock, mount } = await world($, on, [new Error('spawn claudinho ENOENT'), view("⚽ ARS 2–1 CHE 50'")])
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    expect(await (await mount()).findAll({ type: 'Text', text: "⚽ ARS 2–1 CHE 50'" })).toHaveLength(1)
  })

  test('a failed run after a shown line shows nothing: the band never keeps a line the plugin cannot vouch for', async ($, on) => {
    const { clock, mount } = await world($, on, [view("⚽ ARS 2–1 CHE 50'"), new Error('timeout')])
    expect(await (await mount()).findAll({ type: 'Text', text: "⚽ ARS 2–1 CHE 50'" })).toHaveLength(1)
    await clock.advance(15_000)
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('yields to a survey and to a band with no row', async ($, on) => {
    const { mount } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")])
    expect(await (await mount({ hasSurvey: true })).findAll({ type: 'Text' })).toHaveLength(0)
    expect(await (await mount({ maxRows: 0 })).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('the pace', () => {
  for (const line of ["⚽ ARS 2–1 CHE 50'", 'ARS vs LEE in 7h13m', '⚽ ARS 0–0 CHE live · syncing…', '⚽ —']) {
    test(`runs at every 15-second fire on ${line}`, async ($, on) => {
      const { argvs, clock } = await world($, on, [view(line)])
      await clock.advance(15_000)
      await clock.advance(15_000)
      expect(argvs.length).toBe(3)
    })
  }

  for (const [why, answer] of [['the first-run object', FIRST_RUN], ['the complete line', view(COMPLETE, { idle: true })], ['the complete line fitted to a narrow band', view('⚽ World Cup 2026 is co…', { idle: true })]] as const) {
    test(`runs once per five minutes on ${why}`, async ($, on) => {
      const { argvs, clock } = await world($, on, [answer])
      await clock.advance(15_000)
      await clock.advance(15_000)
      expect(argvs.length).toBe(1)
      await clock.advance(300_000)
      expect(argvs.length).toBe(2)
    })
  }

  test('the idle gap never comes from the text: a line that reads like the complete one, the view not saying idle, runs at every fire', async ($, on) => {
    const { argvs, clock } = await world($, on, [view(COMPLETE)])
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs.length).toBe(3)
  })

  test('a headless session starts no timer and runs no process', async ($, on) => {
    const { argvs, clock } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")], { isInteractive: false })
    await clock.advance(15_000)
    expect(argvs).toHaveLength(0)
  })
})
