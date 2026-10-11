import { describe, expect, test } from 'claude-code/testing'
import { view, world } from './world'

/**
 * When the band runs: whenever a surface that draws it (the terminal or the desktop app, the two that raise
 * `AbovePrompt`) is in the session's roster, asked at every fire. Measured on the engine (Oct 11, 2026): the desktop
 * app's session starts with no surface and `isInteractive: false`, exactly as `claude -p` does, then the app
 * attaches; a plugin loaded into a desktop session already open hears `session.start` with no surface while the
 * roster holds `desktop`, and no attach. One pace, however many starts and attaches announce it.
 */
const LINE = "⚽ ARS 2–1 CHE 50'"
const DESKTOP_START = { surface: null, isInteractive: false } as const

describe('the desktop app, a session started fresh', () => {
  test('nothing runs before the app attaches', async ($, on) => {
    const { argvs, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await clock.advance(15_000)
    expect(argvs).toHaveLength(0)
  })

  test('the app attaching runs the CLI at once', async ($, on) => {
    const { argvs, attach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('desktop', 'app')
    expect(argvs).toHaveLength(1)
  })

  test("the band shows the line on the desktop after the app attaches", async ($, on) => {
    const { attach, mount } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('desktop', 'app')
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })

  test('after the attach, the CLI runs at every 15-second fire', async ($, on) => {
    const { argvs, attach, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('desktop', 'app')
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(3)
  })

  test('an attach before the start (a first ask to draw) keeps one pace: one run at once, one per fire', async ($, on) => {
    const { argvs, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, attachFirst: { surface: 'desktop', clientId: 'app' } })
    expect(argvs).toHaveLength(1)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
  })

  test('a second attach keeps one pace: one run per fire after it', async ($, on) => {
    const { argvs, attach, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('desktop', 'app')
    await attach('desktop', 'window2')
    const after = argvs.length
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs.length - after).toBe(2)
  })
})

describe('the desktop app, the plugin loaded into a session already open', () => {
  test('start reports no surface while the roster holds the desktop: the CLI runs at once', async ($, on) => {
    const { argvs } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(argvs).toHaveLength(1)
  })

  test('the band shows the line on the desktop', async ($, on) => {
    const { mount } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })

  test('then the CLI runs at every 15-second fire', async ($, on) => {
    const { argvs, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(3)
  })
})

describe('surfaces that draw no band', () => {
  test('a headless session (claude -p, the SDK: no surface ever) runs nothing', async ($, on) => {
    const { argvs, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(0)
  })

  test('a headless session starts no timer: the roster is asked once, at the start, and never at a fire', async ($, on) => {
    const { clock, rosterReads } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(rosterReads()).toBe(1)
  })

  test('a phone attaching alone starts no timer: the roster is not asked again', async ($, on) => {
    const { attach, clock, rosterReads } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('mobile', 'phone')
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(rosterReads()).toBe(1)
  })

  test('a phone attaching alone (mobile raises no AbovePrompt) runs nothing', async ($, on) => {
    const { argvs, attach, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('mobile', 'phone')
    await clock.advance(15_000)
    expect(argvs).toHaveLength(0)
  })

  test('an editor attaching alone (vscode raises no AbovePrompt) runs nothing', async ($, on) => {
    const { argvs, attach, clock } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: [] })
    await attach('vscode', 'editor')
    await clock.advance(15_000)
    expect(argvs).toHaveLength(0)
  })

  test('a roster of a phone and the desktop app runs', async ($, on) => {
    const { argvs } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['mobile', 'desktop'] })
    expect(argvs).toHaveLength(1)
  })
})

describe('the band surface leaves', () => {
  test('the last desktop client detached: the next fire runs nothing', async ($, on) => {
    const { argvs, clock, detach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(argvs).toHaveLength(1)
    await detach('desktop', 'app')
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(1)
  })

  test('a desktop client attaching again runs the CLI at once', async ($, on) => {
    const { argvs, attach, clock, detach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await detach('desktop', 'app')
    await clock.advance(15_000)
    await attach('desktop', 'app')
    expect(argvs).toHaveLength(2)
  })

  test('one desktop client of two detached: the pace goes on', async ($, on) => {
    const { argvs, attach, clock, detach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await attach('desktop', 'window2')
    const before = argvs.length
    await detach('desktop', 'window2')
    await clock.advance(15_000)
    expect(argvs.length - before).toBe(1)
  })
})

describe('the terminal', () => {
  test('a terminal session runs the CLI at once (start: the terminal, interactive)', async ($, on) => {
    const { argvs } = await world($, on, [view(LINE)])
    expect(argvs).toHaveLength(1)
  })

  test('a terminal session whose start says it is not interactive still runs while the roster holds the terminal', async ($, on) => {
    const { argvs } = await world($, on, [view(LINE)], { start: { surface: 'terminal', isInteractive: false }, surfaces: ['terminal'] })
    expect(argvs).toHaveLength(1)
  })
})
