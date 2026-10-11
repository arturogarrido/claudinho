import { describe, expect, test } from 'claude-code/testing'
import { COMPLETE, held, view, world } from './world'

/**
 * When the band runs: whenever a surface that draws it (the terminal or the desktop app, the two that raise
 * `AbovePrompt`) is in the session's roster, asked at every run, first and again last, just before the spawn. Measured
 * (Oct 11, 2026): a session in the desktop app's launch form starts with no surface and `isInteractive: false`, exactly
 * as `claude -p` does, and a client's attach request (emulated on 2.1.296) then raises `session.attach` with
 * `desktop`; in the app itself (2.1.295) a plugin loaded into a session already open hears `session.start` with no
 * surface while the roster holds `desktop`, and no attach. One pace, however many starts and attaches announce it. A run
 * that finds no band surface, or cannot read the roster, runs nothing and clears the band.
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
    await detach('desktop')
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(1)
  })

  test('a desktop client attaching again runs the CLI at once', async ($, on) => {
    const { argvs, attach, clock, detach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await detach('desktop')
    await clock.advance(15_000)
    await attach('desktop', 'app')
    expect(argvs).toHaveLength(2)
  })

  test('one desktop client of two detached: the pace goes on', async ($, on) => {
    const { argvs, attach, clock, detach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await attach('desktop', 'window2')
    const before = argvs.length
    await detach('window2')
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

describe('a run and the roster, in time', () => {
  test("a start arriving while an attach's run is in flight does not let a second run start beside it", async ($, on) => {
    const { argvs, attach, release } = await world($, on, [held(view(LINE)), view(LINE)], { start: DESKTOP_START, surfaces: [], attachFirst: { surface: 'desktop', clientId: 'app' } })
    expect(argvs).toHaveLength(1)
    await attach('desktop', 'window2')
    expect(argvs).toHaveLength(1)
    await release()
    expect(argvs).toHaveLength(2)
  })

  test('the last band surface leaving while the first run looks for the CLI: no process', async ($, on) => {
    const { argvs, detach, releaseListing } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'], nvm: 'hold' })
    await detach('desktop')
    await releaseListing()
    expect(argvs).toHaveLength(0)
  })

  test('a desktop and a phone attached, the desktop leaving: no run at the next fires (the phone draws no band)', async ($, on) => {
    const { argvs, attach, clock, detach } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await attach('mobile', 'phone')
    const before = argvs.length
    await detach('desktop')
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs.length - before).toBe(0)
  })

  test('an attach while a run is in flight is not lost: its run follows at once, even after an idle answer', async ($, on) => {
    const { argvs, attach, release } = await world($, on, [held(view(COMPLETE, { idle: true })), view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(argvs).toHaveLength(1)
    await attach('desktop', 'window2')
    await release()
    expect(argvs).toHaveLength(2)
  })
})

describe('the band once its surface has left', () => {
  test('the last desktop client detached: the next fire clears the band, and runs nothing', async ($, on) => {
    const { argvs, clock, detach, mount } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await detach('desktop')
    await clock.advance(15_000)
    expect(argvs).toHaveLength(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('an idle line too: the last desktop client detached, the next fire inside the idle gap clears it', async ($, on) => {
    const { argvs, clock, detach, mount } = await world($, on, [view(COMPLETE, { idle: true })], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
    await detach('desktop')
    await clock.advance(15_000)
    expect(argvs).toHaveLength(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('a re-attach shows no old line while its own run is in flight', async ($, on) => {
    const { attach, clock, detach, mount } = await world($, on, [view(LINE), held(view('⚽ ARS 3–1 CHE 80\''))], { start: DESKTOP_START, surfaces: ['desktop'] })
    await detach('desktop')
    await clock.advance(15_000)
    await attach('desktop', 'app')
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('a roster read that is refused', () => {
  test('refused at the start: the pace starts anyway, and the next fire runs once the roster answers', async ($, on) => {
    const { argvs, clock } = await world($, on, [view(LINE)], { rosterDeniedAtStart: true })
    await clock.advance(15_000)
    expect(argvs.length).toBeGreaterThanOrEqual(1)
  })

  test('refused in a run after a shown line: no process, and the band cleared', async ($, on) => {
    const { argvs, clock, denyRoster, mount } = await world($, on, [view(LINE)])
    expect(await (await mount()).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
    denyRoster(true)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(1)
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('nothing escapes a run', () => {
  test("a state write the engine refuses inside a run escapes no timer (the kit fails a file on an unhandled rejection)", async ($, on) => {
    // A refusal is `{ deny }` (a hook that throws is skipped, and the write goes on beneath it).
    on('state.set', () => ({ deny: 'state.set denied' }))
    const { argvs, clock } = await world($, on, [view(LINE)])
    await clock.advance(15_000)
    expect(argvs.length).toBeGreaterThanOrEqual(1)
  })
})
