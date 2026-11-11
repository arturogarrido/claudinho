import { describe, expect, test } from 'claude-code/testing'
import { FIRST_RUN, HOME, momentView, liveRecord, toastsWithTimeout, view, world } from './world'

/**
 * No CLI, or one too old (plugin 0.7.0). One toast per session, 10 seconds, says what to run; `/claudinho` says the
 * same sentence every time it is asked. "No CLI" is said only when the run was rejected AND none of the folders on the
 * PATH the run was handed holds `claudinho`, every probe answering (a probe refused, a relative folder, or no PATH
 * handed, as on Windows: no claim). "Too old": an object that is neither a view, the first-run object nor the fallback
 * object; a view stating no `lang` (older than 0.12.0); an `api` that is an integer below the plugin's floor (1). A view
 * stating no `api` is never old for that alone (0.12.x and 0.13.x print none). The session's flag is reset by every
 * `session.start` (a new session, or a reload).
 */
const LINE = "⚽ ARS 2–1 CHE 50'"
const NO_CLI = 'To see scores, install the CLI: npm i -g @claudinho/cli'
const TOO_OLD = 'This plugin needs a newer CLI: npm i -g @claudinho/cli@latest'
const FAILED = 'The CLI gave no answer.'
const NO_VIEW = "Nothing to show: the CLI's answer is not one this plugin reads."
const MIN = 60_000
const ENOENT = () => new Error('$.process.run(claudinho) failed to start: ENOENT: Executable not found in $PATH: "claudinho"')
/** The folders of the PATH the run is handed under the world's bare host PATH, in order. */
const HANDED = ['/usr/bin', '/bin', `${HOME}/.volta/bin`, `${HOME}/.local/share/pnpm`, `${HOME}/Library/pnpm`, `${HOME}/.bun/bin`, `${HOME}/.npm-global/bin`, `${HOME}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin']
/** The view CLI 0.11.2 prints: `idle` and `empty`, but no `lang` and no `words`. */
const V0112 = view(LINE, { lang: undefined })

describe('no CLI', () => {
  test('one toast, 10 seconds, the install sentence', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [ENOENT()])
    expect(toasts).toEqual([{ text: NO_CLI, timeoutMs: 10_000 }])
  })

  test('every folder of the handed PATH is probed for `claudinho`', async ($, on) => {
    const w = await world($, on, [ENOENT()])
    for (const folder of HANDED) expect(w.probes).toContain(`${folder}/claudinho`)
  })

  test('nothing nags: ten more failed runs, still one toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()])
    await w.clock.advance(10 * MIN)
    expect(w.argvs.length).toBeGreaterThan(5)
    expect(toasts.map((t) => t.text)).toEqual([NO_CLI])
  })

  test('/claudinho says the sentence every time it is asked, and raises no toast of its own', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()])
    expect((await w.command()).text).toBe(NO_CLI)
    expect((await w.command()).text).toBe(NO_CLI)
    expect(toasts).toHaveLength(1)
  })

  test('/claudinho in a headless session (no band run) says the sentence, and nothing toasts', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()], { start: { surface: null, isInteractive: false }, surfaces: [] })
    expect((await w.command()).text).toBe(NO_CLI)
    expect(toasts).toEqual([])
  })

  test('the CLI installed mid-session: the band shows the line within a minute', async ($, on) => {
    const w = await world($, on, [ENOENT(), view(LINE)])
    await w.clock.advance(MIN)
    expect(await (await w.mount()).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })

  test('a new session (a second start) toasts once more', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()])
    await $.session.start({ cwd: '/tmp/claudinho-test', surface: 'terminal', isInteractive: true })
    await w.clock.advance(MIN)
    expect(toasts.map((t) => t.text)).toEqual([NO_CLI, NO_CLI])
  })
})

describe('a CLI that is there but gave no answer: no claim', () => {
  test('a run rejected (a timeout) while a PATH folder holds `claudinho`: no toast, today\'s reply', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [new Error('timeout')], { bins: [`${HOME}/.npm-global/bin/claudinho`] })
    expect(toasts).toEqual([])
    expect((await w.command()).text).toBe(FAILED)
  })

  test('a probe the host refuses: no claim', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()], { refusedProbes: ['/opt/homebrew/bin/claudinho'] })
    expect(toasts).toEqual([])
    expect((await w.command()).text).toBe(FAILED)
  })

  test('a relative folder on the PATH: no claim', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()], { env: { PATH: `node_modules/.bin:/usr/bin`, HOME } })
    expect(toasts).toEqual([])
    expect((await w.command()).text).toBe(FAILED)
  })

  test('Windows (no PATH handed): no claim', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT()], { env: { OS: 'Windows_NT', PATH: 'C:\\Windows' } })
    expect(toasts).toEqual([])
    expect((await w.command()).text).toBe(FAILED)
  })

  test('a run that exited non-zero: no claim, no probe', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [{ stdout: 'error: unknown command', exitCode: 1 }])
    expect(toasts).toEqual([])
    expect(w.probes.filter((p) => p.endsWith('/claudinho') && !p.includes('.nvm'))).toEqual([])
    expect((await w.command()).text).toBe(FAILED)
  })
})

describe('a CLI too old', () => {
  test('a view stating no `lang` (CLI 0.11.2): one toast, 10 seconds, the update sentence; the band still shows its line', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [V0112])
    expect(toasts).toEqual([{ text: TOO_OLD, timeoutMs: 10_000 }])
    expect(await (await w.mount()).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })

  test('a CLI 0.11.2 still toasts its own score change, after the one update toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const rec = (score: [number, number]) => ({ id: '1', score: { home: score[0], away: score[1] }, pinned: true, picked: true, status: 'LIVE', line: `Arsenal ${score[0]}–${score[1]} Chelsea (60')` })
    const live = (score: [number, number]) => view(LINE, { lang: undefined, current: true, staleAfter: '2026-10-10T15:05:00.000Z', live: { items: [rec(score)], total: 1, shown: 1, truncated: false, complete: true } })
    const w = await world($, on, [live([1, 0]), live([2, 0])])
    await w.clock.advance(15_000)
    expect(toasts.map((t) => t.text)).toEqual([TOO_OLD, "⚽ Arsenal 2–0 Chelsea (60')"])
  })

  test('an older CLI\'s `{ line }` object: the update toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [JSON.stringify({ line: LINE })])
    expect(toasts.map((t) => t.text)).toEqual([TOO_OLD])
  })

  test('a view with no `idle` and `empty` (a CLI older than both): the update toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [JSON.stringify({ line: LINE, live: { items: [] }, current: false })])
    expect(toasts.map((t) => t.text)).toEqual([TOO_OLD])
  })

  test('an `api` below the floor (0): the update toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [view(LINE, { api: 0 })])
    expect(toasts.map((t) => t.text)).toEqual([TOO_OLD])
  })

  test('/claudinho says the update sentence every time', async ($, on) => {
    const w = await world($, on, [V0112])
    expect((await w.command()).text).toBe(TOO_OLD)
    expect((await w.command()).text).toBe(TOO_OLD)
  })

  test('nothing nags: later runs of the same old CLI raise no more toasts', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [V0112])
    await w.clock.advance(5 * MIN)
    expect(toasts.map((t) => t.text)).toEqual([TOO_OLD])
  })

  test('one first-run toast per session, whichever cause comes first: no CLI, then an old one', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [ENOENT(), V0112])
    await w.clock.advance(MIN)
    expect(toasts.map((t) => t.text)).toEqual([NO_CLI])
  })
})

describe('a CLI that works: nothing said', () => {
  test('a CLI 0.13.1 view (a `lang`, no `api`): no toast, the line as the reply', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [view(LINE)])
    expect(toasts).toEqual([])
    expect((await w.command()).text.startsWith(LINE)).toBe(true)
  })

  test('`api: 1`: no toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [view(LINE, { api: 1 })])
    expect(toasts).toEqual([])
  })

  test('an `api` that is no integer is not read: no toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [view(LINE, { api: '0' }), view(LINE, { api: 0.5 })])
    expect(toasts).toEqual([])
  })

  test('the fallback object (a refused value, `empty: true`): no toast, today\'s reply', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [JSON.stringify({ line: '⚽ —', empty: true })])
    expect(toasts).toEqual([])
    expect((await w.command()).text).toBe(NO_VIEW)
  })

  test('the first-run object: no toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [FIRST_RUN])
    expect(toasts).toEqual([])
  })

  test('a live CLI 0.13.1 view of the goal moments: no first-run toast', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    await world($, on, [momentView([liveRecord([0, 0])])])
    expect(toasts).toEqual([])
  })
})
