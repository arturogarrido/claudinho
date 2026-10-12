import { describe, expect, test } from 'claude-code/testing'
import { BARE_PATH, COMPLETE, FIRST_RUN, HOME, held, view, world } from './world'

/**
 * `/claudinho`: the band's line now, from one `claudinho ambient --json` run, with the band's PATH and the band's
 * reading of the answer. Where the band would show nothing, one fixed sentence says so, chosen by the answer's fields,
 * never by its text or by a cause the plugin cannot see; the engine prints the plugin's name before it
 * (`claudinho: ...`), so no sentence names the plugin, a command, a version, a path or an error. A reply made from a
 * view carries the view's own disclaimer after a blank line (the plugin never spells it); one made from no view
 * carries none, as the CLI's first-run and fallback objects carry none. The run is the command's own: it writes none
 * of the band's state.
 */
const LINE = "⚽ ARS 2–1 CHE 50'"
const IDLE = 'The edition you follow is over.'
const FIRST = 'No competition followed yet.'
const EMPTY = 'Nothing to show right now: no live match and no next fixture known.'
const NO_VIEW = "Nothing to show: the CLI's answer is not one this plugin reads."
const FAILED = 'The CLI gave no answer.'
/** The disclaimer the CLI puts on every selected competition's view (the test world's `view()` carries it). */
const D = 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.'
/** A reply made from a view: its text, a blank line (a paragraph in the Markdown the desktop row draws), the view's disclaimer. */
const withD = (s: string) => `${s}\n\n${D}`
/** The view a CLI older than `idle` and `empty` prints: a live list and neither field. */
const OLDER_VIEW = JSON.stringify({ line: LINE, context: null, live: { items: [], total: 0, shown: 0, truncated: false, complete: true }, current: false, next: null, pick: null, competition: { slug: 'eng.1' }, degraded: false, source: 'espn', updatedAt: null, staleAfter: null })

describe('the command', () => {
  test('registered once at the start: /claudinho, a description, no argument hint, not immediate', async ($, on) => {
    const { registrations } = await world($, on, [view(LINE)])
    expect(registrations).toHaveLength(1)
    const [spec] = registrations
    expect(spec?.name).toBe('claudinho')
    expect(typeof spec?.description).toBe('string')
    expect(String(spec?.description).trim()).not.toBe('')
    expect(spec?.argumentHint).toBeUndefined()
    expect(spec?.immediate).toBeUndefined()
  })

  test('registered in a headless session too (claude -p, the SDK): the person typed it', async ($, on) => {
    const { registrations } = await world($, on, [view(LINE)], { start: { surface: null, isInteractive: false }, surfaces: [] })
    expect(registrations.map((r) => r.name)).toEqual(['claudinho'])
  })
})

describe('what it runs', () => {
  test('one CLI run per command: ambient --json, no --columns, an empty stdin', async ($, on) => {
    const { argvs, stdins, command } = await world($, on, [view(LINE), view(LINE)])
    expect(argvs).toHaveLength(1) // the band's first run
    await command()
    expect(argvs).toHaveLength(2)
    expect(argvs[1]).toEqual(['claudinho', 'ambient', '--json'])
    expect(stdins[1]).toBe('')
  })

  test("the band's PATH: under a bare host PATH the run is handed the same extended PATH as the band's", async ($, on) => {
    const { envs, command } = await world($, on, [view(LINE), view(LINE)])
    await command()
    expect(envs).toHaveLength(2)
    expect(envs[1]).toEqual(envs[0])
    expect(String(envs[1]?.PATH).startsWith(`${BARE_PATH}:`)).toBe(true)
    expect(envs[1]?.PATH).toContain(`${HOME}/.npm-global/bin`)
    expect(envs[1]?.PATH).toContain('/opt/homebrew/bin')
  })

  test('on Windows no env is handed, as for the band', async ($, on) => {
    const { envs, command } = await world($, on, [view(LINE), view(LINE)], { env: { OS: 'Windows_NT', PATH: 'C:\\Windows' } })
    await command()
    expect(envs[1]).toBeUndefined()
  })

  test('text typed after the command is ignored: the same run, the same reply', async ($, on) => {
    const { argvs, command } = await world($, on, [view(LINE), view(LINE)])
    const r = await command('next Arsenal --columns 5')
    expect(argvs[1]).toEqual(['claudinho', 'ambient', '--json'])
    expect(r.text).toBe(withD(LINE))
  })

  test('a headless session: the band ran nothing, the command runs the CLI once and answers', async ($, on) => {
    const { argvs, command } = await world($, on, [view(LINE)], { start: { surface: null, isInteractive: false }, surfaces: [] })
    expect(argvs).toHaveLength(0)
    const r = await command()
    expect(argvs).toHaveLength(1)
    expect(r.text).toBe(withD(LINE))
  })
})

describe('what it answers, one cell per shape the CLI prints and per way the run fails', () => {
  for (const line of [LINE, 'ARS vs LEE in 7h13m', '⚽ ARS 0–0 CHE live · syncing…', '⚽ claudinho follow']) {
    test(`a line the band shows is the reply, verbatim, then the view's disclaimer: ${line}`, async ($, on) => {
      const { command } = await world($, on, [view('ARS vs LEE in 7h13m'), view(line)])
      expect((await command()).text).toBe(withD(line))
    })
  }

  test('the line is never fitted to the window (no --columns): 150 columns arrive whole', async ($, on) => {
    const long = `⚽ ${'A'.repeat(146)}`
    const { command } = await world($, on, [view(LINE), view(long)])
    expect((await command()).text).toBe(withD(long))
  })

  for (const [why, answer] of [['the complete line', view(COMPLETE, { idle: true })], ['an idle view whatever its text', view(LINE, { idle: true })]] as const) {
    test(`an idle view (the edition over): a fixed sentence, never the line and its command: ${why}`, async ($, on) => {
      const { command } = await world($, on, [view(LINE), answer])
      expect((await command()).text).toBe(withD(IDLE))
    })
  }

  test('the first-run object (no competition chosen): a fixed sentence, never its line', async ($, on) => {
    const { command } = await world($, on, [view(LINE), FIRST_RUN])
    expect((await command()).text).toBe(FIRST)
  })

  for (const [why, answer] of [['a view that says empty', view('⚽ —', { empty: true })], ['a view that says empty whatever its text', view(LINE, { empty: true })], ['a view whose line is blank', view('   ')], ['an idle view that says empty', view(COMPLETE, { idle: true, empty: true })]] as const) {
    test(`nothing known: the empty sentence: ${why}`, async ($, on) => {
      const { command } = await world($, on, [view(LINE), answer])
      expect((await command()).text).toBe(withD(EMPTY))
    })
  }

  for (const [why, answer] of [["the CLI's fallback object (a refused value, a throw)", '{"line":"⚽ —","empty":true}'], ["an older CLI's line-only object", '{"line":"⚽ —"}'], ['a line-only object with a score-like line', `{"line":"${LINE}"}`], ['a view from a CLI older than idle and empty', OLDER_VIEW]] as const) {
    test(`an answer that is no view: the no-view sentence: ${why}`, async ($, on) => {
      const { command } = await world($, on, [view(LINE), answer])
      expect((await command()).text).toBe(NO_VIEW)
    })
  }

  for (const [why, answer] of [
    ['the binary not found', new Error('ENOENT: Executable not found in $PATH: claudinho')],
    ['a timeout', new Error('process.run: timed out after 2000ms')],
    ['a non-zero exit', { stdout: view(LINE), exitCode: 1 }],
    ['a cut stdout', { stdout: view(LINE), truncated: true as const }],
    ['a line that is not JSON', "⚽ ARS 2–1 CHE 50'"],
    ['an empty answer', ''],
    ['an object with no line', '{"current":false}'],
  ] as const) {
    test(`a failed run: one plain sentence, no error text: ${why}`, async ($, on) => {
      const { command } = await world($, on, [view(LINE), answer])
      expect((await command()).text).toBe(FAILED)
    })
  }
})

describe('the disclaimer', () => {
  for (const [why, over] of [['no disclaimer field (an older CLI)', { disclaimer: undefined }], ['a disclaimer that is no string', { disclaimer: 7 }], ['an empty disclaimer', { disclaimer: '' }]] as const) {
    test(`a view with ${why}: the line alone, never a spelled copy`, async ($, on) => {
      const { command } = await world($, on, [view(LINE), view(LINE, over)])
      expect((await command()).text).toBe(LINE)
    })
  }

  for (const [why, answer, sentence] of [['the first-run object', FIRST_RUN, FIRST], ["the CLI's fallback object", '{"line":"⚽ —","empty":true}', NO_VIEW], ['a failed run', new Error('timeout'), FAILED]] as const) {
    test(`a reply made from no view carries none: ${why}`, async ($, on) => {
      const { command } = await world($, on, [view(LINE), answer])
      expect((await command()).text).toBe(sentence)
    })
  }
})

describe('what a view is: each clause decides alone', () => {
  // Each fixture fails ONE clause of what makes an object a view the plugin reads, every other clause passing.
  const base = { line: LINE, context: null, current: false, competition: { slug: 'eng.1' }, staleAfter: null, disclaimer: D }
  const list = { items: [], total: 0, shown: 0, truncated: false, complete: true }
  for (const [why, obj] of [
    ['a live list and `idle`, no `empty`', { ...base, live: list, idle: false }],
    ['a live list and `empty`, no `idle`', { ...base, live: list, empty: false }],
    ['`idle` and `empty`, no live list', { ...base, idle: false, empty: false }],
    ['`idle` and `empty`, a live object with no items array', { ...base, live: { total: 0 }, idle: false, empty: false }],
  ] as const) {
    test(`no view: ${why}: the command says so and the band shows nothing`, async ($, on) => {
      const { command, mount } = await world($, on, [JSON.stringify(obj), JSON.stringify(obj)])
      expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
      expect((await command()).text).toBe(NO_VIEW)
    })
  }
})

describe('the other commands', () => {
  for (const name of ['cost', 'claudinho-mode']) {
    test(`/${name} is not the plugin's: it passes beneath, and no process runs`, async ($, on) => {
      const { argvs } = await world($, on, [view(LINE)])
      const r = await $.command.run({ command: name, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
      expect(r.text).toBe(`engine ran /${name}`)
      expect(argvs).toHaveLength(1) // the band's first run alone
    })
  }
})

describe('the bound', () => {
  test("the command's run and the band's are each bounded at two seconds (the engine's own default is 30)", async ($, on) => {
    const { timeouts, command } = await world($, on, [view(LINE), view(LINE)])
    await command()
    expect(timeouts).toEqual([2_000, 2_000])
  })
})

describe('the command leaves the band alone', () => {
  test("a reply with another line does not change the band's line", async ($, on) => {
    const { command, mount } = await world($, on, [view(LINE), view('⚽ ARS 3–1 CHE 80\'')])
    await command()
    expect((await (await mount()).findAll({ type: 'Text' })).map((t) => t.text)).toEqual([LINE])
  })

  test('a failed command run does not clear a shown band', async ($, on) => {
    const { command, mount } = await world($, on, [view(LINE), new Error('timeout')])
    expect((await command()).text).toBe(FAILED)
    expect((await (await mount()).findAll({ type: 'Text' })).map((t) => t.text)).toEqual([LINE])
  })

  test('a command answered while the band shows nothing does not draw the band', async ($, on) => {
    const { command, mount } = await world($, on, [view('⚽ —', { empty: true }), view(LINE)])
    expect((await command()).text).toBe(withD(LINE))
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('an idle band keeps its five-minute pace: a command answering a live line does not make the band run at every fire', async ($, on) => {
    const { argvs, clock, command } = await world($, on, [view(COMPLETE, { idle: true }), view(LINE), view(COMPLETE, { idle: true })])
    await command()
    expect(argvs).toHaveLength(2)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2) // still the idle gap
  })

  test('a current view the command reads raises no toast and does not move the toasts\' baseline: the band\'s next view still toasts the goal', async ($, on) => {
    const texts: string[] = []
    on('ui.toast', (_$, e) => {
      texts.push(e.text)
      return { value: undefined }
    })
    const item = (home: number) => ({ id: '1', status: 'LIVE', score: { home, away: 0 }, pinned: true, line: `Arsenal ${home}–0 Chelsea (60')` })
    const live = (home: number) =>
      view(`⚽ ARS ${home}–0 CHE 60'`, { live: { items: [item(home)], total: 1, shown: 1, truncated: false, complete: true }, current: true, updatedAt: '2026-10-10T15:00:00.000Z', staleAfter: '2026-10-10T15:05:00.000Z' })
    const { clock, command } = await world($, on, [live(1), live(2), live(2)])
    await command() // the command reads the goal first
    expect(texts).toEqual([])
    await clock.advance(15_000) // the band's next current view: the goal against the band's own baseline
    expect(texts).toEqual(["⚽ Arsenal 2–0 Chelsea (60')"])
  })

  test("a current view the command reads does not set the prompt's context", async ($, on) => {
    const current = view(LINE, { context: 'CTX', live: { items: [{ id: '1', status: 'LIVE' }], total: 1, shown: 1, truncated: false, complete: true }, current: true, updatedAt: '2026-10-10T15:00:00.000Z', staleAfter: '2026-10-10T15:05:00.000Z' })
    const { command } = await world($, on, [view(LINE), current])
    await command()
    const r = await $.prompt.submit({ text: 'score?' } as Parameters<typeof $.prompt.submit>[0])
    expect(r.context ?? []).toEqual([])
  })

  test("a command while the band's run is in flight runs its own process and answers; the band's run then draws its line", async ($, on) => {
    const { argvs, command, mount, release } = await world($, on, [held(view(LINE)), view('ARS vs LEE in 7h13m')])
    expect(argvs).toHaveLength(1) // the band's run, held
    expect((await command()).text).toBe(withD('ARS vs LEE in 7h13m'))
    expect(argvs).toHaveLength(2)
    await release()
    expect((await (await mount()).findAll({ type: 'Text' })).map((t) => t.text)).toEqual([LINE])
  })

  test('two commands in a row: two runs, two replies', async ($, on) => {
    const { argvs, command } = await world($, on, [view(LINE), view(LINE), view('ARS vs LEE in 7h13m')])
    expect((await command()).text).toBe(withD(LINE))
    expect((await command()).text).toBe(withD('ARS vs LEE in 7h13m'))
    expect(argvs).toHaveLength(3)
  })
})
