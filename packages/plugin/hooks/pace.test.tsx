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

describe('the roster read again just before the spawn', () => {
  test('the roster refused between the first read and the spawn, after a shown line: no process, and the band cleared', async ($, on) => {
    const { argvs, clock, denyRosterFrom, mount, rosterReads } = await world($, on, [view(LINE)])
    expect(await (await mount()).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
    // The next run's first roster read answers; its second (just before the spawn) and every one after are refused.
    const before = rosterReads()
    denyRosterFrom(before + 2)
    await clock.advance(15_000)
    expect(rosterReads()).toBeGreaterThanOrEqual(before + 2)
    expect(argvs).toHaveLength(1)
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('a cleared band comes back', () => {
  test('an idle line cleared by a refused roster read is shown again at the next fire the roster answers (the idle gap does not hold it)', async ($, on) => {
    const { argvs, clock, denyRoster, mount } = await world($, on, [view(COMPLETE, { idle: true })])
    denyRoster(true)
    await clock.advance(15_000)
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    denyRoster(false)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    expect(await (await mount()).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
  })
})

describe('a window leaving and coming back before the next fire', () => {
  test('the last desktop client detached and attached again at once: no old line while its run is in flight', async ($, on) => {
    const { attach, detach, mount } = await world($, on, [view(LINE), held(view('⚽ ARS 3–1 CHE 80\''))], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
    await detach('desktop')
    await attach('desktop', 'app')
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('one desktop client of two leaving: the line stays, and no run starts', async ($, on) => {
    const { argvs, attach, detach, mount } = await world($, on, [view(LINE)], { start: DESKTOP_START, surfaces: ['desktop'] })
    await attach('desktop', 'window2')
    const before = argvs.length
    await detach('window2')
    expect(argvs.length - before).toBe(0)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })
})

describe('a band cleared at the second roster read comes back', () => {
  test("an idle line cleared between a forced run's two roster reads is shown again at the next fire the roster answers", async ($, on) => {
    const { argvs, attach, clock, denyRoster, denyRosterFrom, mount, rosterReads } = await world($, on, [view(COMPLETE, { idle: true })])
    expect(argvs).toHaveLength(1)
    expect(await (await mount()).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
    // The attach's forced run: its first roster read answers, its second (just before the spawn) is refused.
    const before = rosterReads()
    denyRosterFrom(before + 2)
    await attach('desktop', 'app')
    expect(rosterReads()).toBeGreaterThanOrEqual(before + 2)
    expect(argvs).toHaveLength(1)
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    denyRoster(false)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    expect(await (await mount()).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
  })
})

describe('a two-write change refused half-way leaves a state the next fire repairs', () => {
  test('an idle answer whose band write is refused once: the next fire runs the CLI and shows it (no idle gap left behind)', async ($, on) => {
    let refused = false
    on('state.set', (_$, e, next) => {
      if (!refused && e.key === 'band' && e.value !== null) {
        refused = true
        return { deny: 'state.set denied' }
      }
      return next(e)
    })
    const { argvs, clock, mount } = await world($, on, [view(COMPLETE, { idle: true })])
    expect(refused).toBe(true)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    expect(await (await mount()).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
  })
})

describe('a window coming back while a slower detach hook beneath ours runs', () => {
  test('the last desktop client detached, a slow hook beneath, the window back before it ends: no old line while the new run is in flight', async ($, on) => {
    const { attach, clock, detachStart, mount, releaseDetach } = await world($, on, [view(LINE), held(view('⚽ ARS 3–1 CHE 80\''))], { start: DESKTOP_START, surfaces: ['desktop'], holdDetach: true })
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
    const leaving = detachStart('desktop')
    // The detach reaches the slow hook beneath ours before the window comes back.
    await clock.advance(1)
    await attach('desktop', 'app')
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
    await releaseDetach()
    await leaving
  })
})

describe('a forced run over an idle pace', () => {
  test("an attach's forced run answering a live line over a recent idle pace, its band write refused once: the next fire runs the CLI", async ($, on) => {
    let refused = false
    on('state.set', (_$, e, next) => {
      const v = e.value as { text?: unknown } | null
      if (!refused && e.key === 'band' && v !== null && v.text === LINE) {
        refused = true
        return { deny: 'state.set denied' }
      }
      return next(e)
    })
    const { argvs, attach, clock, mount } = await world($, on, [view(COMPLETE, { idle: true }), view(LINE)])
    await attach('desktop', 'app')
    expect(refused).toBe(true)
    expect(argvs).toHaveLength(2)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(3)
    expect(await (await mount()).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })

  test("a detach's clear whose band write lands after a reconnect's fresh idle answer keeps that answer", async ($, on) => {
    let hold = false
    let release: () => void = () => {}
    on('state.set', async (_$, e, next) => {
      if (hold && e.key === 'band' && e.value === null) {
        hold = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return next(e)
    })
    const { argvs, attach, clock, detachStart, mount } = await world($, on, [view(LINE), view(COMPLETE, { idle: true })], { start: DESKTOP_START, surfaces: ['desktop'] })
    hold = true
    const leaving = detachStart('desktop')
    await clock.advance(1)
    // The detach's clear reached its band write, which is held now.
    expect(hold).toBe(false)
    await attach('desktop', 'app')
    expect(argvs).toHaveLength(2)
    release()
    await leaving
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
  })
})

describe("a detach's clear applied in the instant after a reconnect's answer landed", () => {
  test("the clear retried after the answer's write landed, before its run went on, keeps the answer", async ($, on) => {
    let holdClear = false
    let holdAnswer = false
    let releaseClear: () => void = () => {}
    let releaseAnswer: () => void = () => {}
    let answerLanded = false
    on('state.set', async (_$, e, next) => {
      if (holdClear && e.key === 'band' && e.value === null) {
        holdClear = false
        await new Promise<void>((resolve) => {
          releaseClear = resolve
        })
        return next(e)
      }
      if (holdAnswer && e.key === 'band' && e.value !== null) {
        holdAnswer = false
        // The answer lands here; the run that wrote it waits until the test lets it go on.
        const r = await next(e)
        answerLanded = true
        await new Promise<void>((resolve) => {
          releaseAnswer = resolve
        })
        return r
      }
      return next(e)
    })
    const { attach, clock, detachStart, mount } = await world($, on, [view(LINE), view(COMPLETE, { idle: true })], { start: DESKTOP_START, surfaces: ['desktop'] })
    holdClear = true
    const leaving = detachStart('desktop')
    await clock.advance(1)
    expect(holdClear).toBe(false)
    holdAnswer = true
    await attach('desktop', 'app')
    expect(answerLanded).toBe(true)
    // The clear goes on now, while the answer's run has not yet gone past its write.
    releaseClear()
    await leaving
    await clock.advance(1)
    releaseAnswer()
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
  })
})

describe('a clear invalidates the runs it covers: they neither write nor tighten after it', () => {
  test("a clear landing after an idle answer's band write and before its run went on: the next fire runs the CLI", async ($, on) => {
    let holdAnswer = false
    let landed = false
    let releaseAnswer: () => void = () => {}
    on('state.set', async (_$, e, next) => {
      if (holdAnswer && e.key === 'band' && e.value !== null) {
        holdAnswer = false
        const r = await next(e)
        landed = true
        await new Promise<void>((resolve) => {
          releaseAnswer = resolve
        })
        return r
      }
      return next(e)
    })
    const { argvs, attach, clock, denyRoster, detach, mount } = await world($, on, [view(COMPLETE, { idle: true })])
    holdAnswer = true
    await attach('desktop', 'app')
    expect(landed).toBe(true)
    expect(argvs).toHaveLength(2)
    // The desktop window leaves while that run waits; its detach cannot read the roster, so it clears.
    denyRoster(true)
    await detach('app')
    denyRoster(false)
    releaseAnswer()
    await clock.advance(1)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(3)
    expect(await (await mount()).findAll({ type: 'Text', text: COMPLETE })).toHaveLength(1)
  })

  test('a run that began before the last window left writes nothing after the detach: no line while the reconnect\'s run is in flight', async ($, on) => {
    const OLD = "⚽ ARS 2–2 CHE 70'"
    let holdClear = false
    let releaseClear: () => void = () => {}
    on('state.set', async (_$, e, next) => {
      if (holdClear && e.key === 'band' && e.value === null) {
        holdClear = false
        await new Promise<void>((resolve) => {
          releaseClear = resolve
        })
      }
      return next(e)
    })
    const { argvs, attach, clock, detachStart, mount, release } = await world($, on, [view(LINE), held(view(OLD)), held(view('⚽ ARS 3–2 CHE 80\''))], { start: DESKTOP_START, surfaces: ['desktop'] })
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    holdClear = true
    const leaving = detachStart('desktop')
    await clock.advance(1)
    expect(holdClear).toBe(false)
    await attach('desktop', 'app')
    await release()
    expect(argvs).toHaveLength(3)
    releaseClear()
    await leaving
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test("a detach whose roster read is slow does not erase the line a reconnect's run wrote meanwhile", async ($, on) => {
    const LINE2 = "⚽ ARS 3–1 CHE 80'"
    const { argvs, attach, clock, detachStart, holdNextRosterRead, mount, releaseRosterRead } = await world($, on, [view(LINE), view(LINE2)], { start: DESKTOP_START, surfaces: ['desktop'] })
    holdNextRosterRead()
    const leaving = detachStart('desktop')
    await clock.advance(1)
    await attach('desktop', 'app')
    expect(argvs).toHaveLength(2)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE2 })).toHaveLength(1)
    await releaseRosterRead()
    await leaving
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE2 })).toHaveLength(1)
  })
})

describe('a run the detach invalidated answers after its clear completed', () => {
  test('its answer is not written: no line while the reconnect\'s run is in flight', async ($, on) => {
    const OLD = "⚽ ARS 2–2 CHE 70'"
    const { argvs, attach, clock, detach, mount, release } = await world($, on, [view(LINE), held(view(OLD)), held(view('⚽ ARS 3–2 CHE 80\''))], { start: DESKTOP_START, surfaces: ['desktop'] })
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    await detach('desktop')
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
    await attach('desktop', 'app')
    await release()
    expect(argvs).toHaveLength(3)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('a clear judges the line that landed, not a write that was only asked', () => {
  test("a reconnect's band write refused once does not shield the pre-detach line from the slow detach's clear", async ($, on) => {
    const LINE2 = "⚽ ARS 3–1 CHE 80'"
    let refused = false
    on('state.set', (_$, e, next) => {
      const v = e.value as { text?: unknown } | null
      if (!refused && e.key === 'band' && v !== null && v.text === LINE2) {
        refused = true
        return { deny: 'state.set denied' }
      }
      return next(e)
    })
    const { attach, clock, detachStart, holdNextRosterRead, mount, releaseRosterRead } = await world($, on, [view(LINE), view(LINE2)], { start: DESKTOP_START, surfaces: ['desktop'] })
    holdNextRosterRead()
    const leaving = detachStart('desktop')
    await clock.advance(1)
    await attach('desktop', 'app')
    expect(refused).toBe(true)
    await releaseRosterRead()
    await leaving
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(0)
  })

  test("a reconnect's band write still held does not shield the pre-detach line from the slow detach's clear, and lands after it", async ($, on) => {
    const LINE2 = "⚽ ARS 3–1 CHE 80'"
    let holding = false
    let releaseWrite: () => void = () => {}
    on('state.set', async (_$, e, next) => {
      const v = e.value as { text?: unknown } | null
      if (!holding && e.key === 'band' && v !== null && v.text === LINE2) {
        holding = true
        await new Promise<void>((resolve) => {
          releaseWrite = resolve
        })
      }
      return next(e)
    })
    const { attach, clock, detachStart, holdNextRosterRead, mount, releaseRosterRead } = await world($, on, [view(LINE), view(LINE2)], { start: DESKTOP_START, surfaces: ['desktop'] })
    holdNextRosterRead()
    const leaving = detachStart('desktop')
    await clock.advance(1)
    await attach('desktop', 'app')
    expect(holding).toBe(true)
    await releaseRosterRead()
    await leaving
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(0)
    releaseWrite()
    await clock.advance(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE2 })).toHaveLength(1)
  })

  test("a run's band write submitted before a detach invalidated it, landing after (the clear's own write refused): its line is not left on show", async ($, on) => {
    const PRE = "⚽ ARS 2–2 CHE 70'"
    let holdingPre = false
    let releasePre: () => void = () => {}
    let refuseClear = false
    on('state.set', async (_$, e, next) => {
      const v = e.value as { text?: unknown } | null
      if (!holdingPre && e.key === 'band' && v !== null && v.text === PRE) {
        holdingPre = true
        await new Promise<void>((resolve) => {
          releasePre = resolve
        })
        return next(e)
      }
      if (refuseClear && e.key === 'band' && e.value === null) {
        refuseClear = false
        return { deny: 'state.set denied' }
      }
      return next(e)
    })
    const { argvs, attach, clock, detach, mount } = await world($, on, [view('⚽ —', { empty: true }), view(PRE), held(view("⚽ ARS 3–2 CHE 80'"))], { start: DESKTOP_START, surfaces: ['desktop'] })
    await clock.advance(15_000)
    expect(holdingPre).toBe(true)
    refuseClear = true
    await detach('desktop')
    expect(refuseClear).toBe(false)
    await attach('desktop', 'app')
    releasePre()
    await clock.advance(1)
    await clock.advance(1)
    expect(argvs).toHaveLength(3)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: PRE })).toHaveLength(0)
  })
})

describe('an invalidated run never writes its line, even for an instant', () => {
  test('the run the detach invalidated, answering after the clear: no band write carries its line', async ($, on) => {
    const OLD = "⚽ ARS 2–2 CHE 70'"
    const written: unknown[] = []
    on('state.set', (_$, e, next) => {
      if (e.key === 'band') written.push(e.value === null ? null : (e.value as { text?: unknown }).text)
      return next(e)
    })
    const { argvs, attach, clock, detach, release } = await world($, on, [view(LINE), held(view(OLD)), held(view("⚽ ARS 3–2 CHE 80'"))], { start: DESKTOP_START, surfaces: ['desktop'] })
    await clock.advance(15_000)
    await detach('desktop')
    await attach('desktop', 'app')
    await release()
    expect(argvs).toHaveLength(3)
    expect(written).not.toContain(OLD)
  })
})

describe('a line another module load wrote (a hot reload keeps the host state, not the module)', () => {
  // The kit loads the module once, so a hook beneath ours stamps the first line as a previous load's: another load
  // tag and a run number higher than any this load has taken, as a value left before a reload looks.
  test("the last window leaving clears a previous load's line: a window attaching again shows no old line while its run is in flight", async ($, on) => {
    let stamped = false
    on('state.set', (_$, e, next) => {
      if (!stamped && e.key === 'band' && e.value !== null) {
        stamped = true
        const previous = { ...e.value, seq: 50, load: 'a-previous-load' } as unknown as typeof e.value
        return next({ ...e, value: previous })
      }
      return next(e)
    })
    const { attach, detach, mount } = await world($, on, [view(LINE), held(view("⚽ ARS 3–1 CHE 80'"))], { start: DESKTOP_START, surfaces: ['desktop'] })
    expect(stamped).toBe(true)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
    await detach('desktop')
    await attach('desktop', 'app')
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test("a roster refused for good clears a previous load's line at the next fire", async ($, on) => {
    let stamped = false
    on('state.set', (_$, e, next) => {
      if (!stamped && e.key === 'band' && e.value !== null) {
        stamped = true
        const previous = { ...e.value, seq: 50, load: 'a-previous-load' } as unknown as typeof e.value
        return next({ ...e, value: previous })
      }
      return next(e)
    })
    const { clock, denyRoster, mount } = await world($, on, [view(LINE)])
    expect(stamped).toBe(true)
    expect(await (await mount()).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
    denyRoster(true)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })
})
