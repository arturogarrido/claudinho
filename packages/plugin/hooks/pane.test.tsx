import { describe, expect, test } from 'claude-code/testing'
import { FIRST_RUN, NOW, held, view, world } from './world'

/**
 * The match pane (plugin 0.4.0): `/claudinho match` binds the match the person follows now (the first record of the
 * command's own `ambient --json` live list, else its `next`) with the view's competition, reads it with one
 * `claudinho match <id> --json --competition <slug>` run, opens the pane `match` (title "claudinho") and draws the
 * CLI's `lines` verbatim, then a blank row, then the attribution and the disclaimer, dimmed. The command's reply is the
 * bare `/claudinho` reply to the same reading. While open, the pane re-reads its match on a score change a band run
 * observes, when the match enters or leaves a current view's live list, at kickoff, and every 2 minutes while the last
 * answer is in play or failed; never more than one read in flight; it stops after a finished answer and on close.
 * The design (revision 3) and the mocks the maintainer reviewed are in the PR's review records.
 */
const LINE = "⚽ ARS 2–1 CHE 50'"
const D = 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.'
const A = 'Live data: ESPN'
const withD = (s: string) => `${s}\n\n${A}\n\n${D}`
const FAILED = 'The CLI gave no answer.'
const NO_VIEW = "Nothing to show: the CLI's answer is not one this plugin reads."
const REFRESH_FAILED = 'Could not refresh: showing the last reading.'
const ID = '401879286'
const STALE_AFTER = new Date(NOW + 5 * 60_000).toISOString()

/** A current view with one live, pinned record of the bound match at `home`–`away`, in `slug`. */
const live = (home: number, away: number, over: Record<string, unknown> = {}) =>
  view(LINE, {
    current: true,
    staleAfter: STALE_AFTER,
    live: { items: [{ id: ID, line: `Arsenal ${home}–${away} Chelsea (50')`, score: { home, away }, pinned: true, picked: true }], total: 1, shown: 1, truncated: false, complete: true },
    ...over,
  })
/** A current view with nothing live and `next` the bound match, kicking off at `kickoff`. */
const upcoming = (kickoff = new Date(NOW + 10 * 60_000).toISOString(), over: Record<string, unknown> = {}) =>
  view('ARS vs CHE in 10m', { current: true, staleAfter: STALE_AFTER, next: { id: ID, kickoff, status: 'SCHEDULED' }, ...over })
/** A current view of the bound competition with an empty live list. */
const nothingLive = () => view('ARS vs LEE in 6d', { current: true, staleAfter: STALE_AFTER, next: { id: '999', kickoff: '2026-10-17T11:30:00.000Z', status: 'SCHEDULED' } })

const ROWS = ['Arsenal 2–1 Chelsea', '  Premier League', "  League · Emirates Stadium, London", "  Sat 15:00  50'", '', "  9'   Goal  ARS  Bukayo Saka"]
/** What `claudinho match <id> --json` prints: one JSON value, pretty-printed as the CLI's `emitJson` does. */
const answer = (over: Record<string, unknown> = {}, match: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      degraded: false,
      match: { id: ID, status: 'LIVE', kickoff: new Date(NOW - 50 * 60_000).toISOString(), score: { home: 2, away: 1 }, ...match },
      source: 'espn',
      marketComplete: true,
      marketSignal: null,
      lines: ROWS,
      attribution: A,
      disclaimer: D,
      competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' },
      ...over,
    },
    null,
    2,
  )
const finished = (rows = ['Arsenal 3–1 Chelsea', '  Sat 15:00  FT']) => answer({ lines: rows }, { status: 'FT', score: { home: 3, away: 1 } })
const scheduled = (kickoff: string) => answer({ lines: ['Arsenal vs Chelsea', '  Sat 15:10'] }, { status: 'SCHEDULED', kickoff, score: undefined })

type Mounted = Awaited<ReturnType<Awaited<ReturnType<typeof world>>['mountPane']>>
/** The pane's text rows in order, a blank row as ''. */
const texts = async (pane: Mounted) => (await pane.findAll({ type: 'Text' })).map((t) => (t.text.trim() === '' ? '' : t.text))
const SURFACES = ['terminal', 'desktop'] as const

describe('opening it', () => {
  test('/claudinho match on a live match: ambient, then match <id> --json --competition <slug>; the pane opens; the reply is the bare reply', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
    const r = await w.command('match')
    expect(r.text).toBe(withD(LINE))
    expect(w.argvs.slice(1)).toEqual([
      ['claudinho', 'ambient', '--json'],
      ['claudinho', 'match', ID, '--json', '--competition', 'eng.1'],
    ])
    expect(w.opens).toEqual([{ id: 'match', title: 'claudinho' }])
  })

  test('the match run: an empty stdin, the band PATH, a 5-second bound', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
    await w.command('match')
    const i = w.argvs.findIndex((a) => a[1] === 'match')
    expect(w.stdins[i]).toBe('')
    expect(w.envs[i]).toEqual(w.envs[0])
    expect(w.timeouts[i]).toBe(5_000)
  })

  test('nothing live: the next fixture is bound', async ($, on) => {
    const w = await world($, on, [upcoming()], { matchAnswers: [scheduled(new Date(NOW + 10 * 60_000).toISOString())] })
    await w.command('match')
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json', '--competition', 'eng.1']])
    expect(w.opens).toHaveLength(1)
  })

  test('the first live record is bound, whatever follows it', async ($, on) => {
    const two = view(LINE, { current: true, staleAfter: STALE_AFTER, next: { id: '777' }, live: { items: [{ id: ID, line: 'x', score: { home: 1, away: 0 } }, { id: '555', line: 'y', score: { home: 0, away: 0 } }], total: 2, shown: 2, truncated: false, complete: true } })
    const w = await world($, on, [two], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.matchRuns()[0]?.[2]).toBe(ID)
  })

  for (const [label, ambient] of [
    ['a failed run', new Error('ENOENT')],
    ['the first run', FIRST_RUN],
    ['an answer that is no view', JSON.stringify({ line: LINE, empty: true })],
    ['an empty view (nothing live, no next)', view('', { empty: true })],
    ['the edition over', view('⚽ World Cup 2026 is complete · claudinho follow --list', { idle: true })],
    ['a view naming no competition', view(LINE, { current: true, competition: null, live: { items: [{ id: ID, line: 'x', score: { home: 1, away: 0 } }], total: 1, shown: 1, truncated: false, complete: true } })],
  ] as const) {
    test(`nothing to bind (${label}): no match run, no pane; the bare reply`, async ($, on) => {
      const w = await world($, on, [ambient], { matchAnswers: [answer()] })
      const bare = (await w.command()).text
      const r = await w.command('match')
      expect(r.text).toBe(bare)
      expect(w.matchRuns()).toEqual([])
      expect(w.opens).toEqual([])
    })
  }

  for (const args of ['', 'next Arsenal', 'Match', 'match now']) {
    test(`/claudinho ${JSON.stringify(args)}: today's reply, no match run, no pane`, async ($, on) => {
      const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
      const r = await w.command(args)
      expect(r.text).toBe(withD(LINE))
      expect(w.matchRuns()).toEqual([])
      expect(w.opens).toEqual([])
    })
  }

  test('surrounding spaces are not a word: " match " opens the pane', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
    await w.command('  match ')
    expect(w.opens).toHaveLength(1)
  })

  test('headless (claude -p): the same runs, the open asked, the bare reply', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()], start: { surface: null, isInteractive: false }, surfaces: [] })
    const r = await w.command('match')
    expect(r.text).toBe(withD(LINE))
    expect(w.matchRuns()).toHaveLength(1)
    expect(w.opens).toHaveLength(1)
  })
})

describe('what it draws', () => {
  for (const surface of SURFACES) {
    test(`${surface}: the CLI's lines verbatim, a blank row, the attribution and the disclaimer dimmed; each line wraps; no button`, async ($, on) => {
      const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
      await w.command('match')
      const pane = await w.mountPane(surface)
      expect(await texts(pane)).toEqual([...ROWS, '', A, D])
      const els = await pane.findAll({ type: 'Text' })
      expect(els.at(-1)?.props.dimColor).toBe(true)
      expect(els.at(-2)?.props.dimColor).toBe(true)
      for (const el of els.slice(0, ROWS.length)) expect(el.props.wrap ?? 'wrap').toBe('wrap')
      expect(await pane.findAll({ type: 'Button' })).toEqual([])
    })
  }

  test('a null attribution (the CLI printed none): the disclaimer alone after the blank row', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer({ attribution: null, lines: ['  Premier League', '  Not found between 2026-10-12 and 2026-10-27: no match with id 401879286 in that span.'] })] })
    await w.command('match')
    expect(await texts(await w.mountPane())).toEqual(['  Premier League', '  Not found between 2026-10-12 and 2026-10-27: no match with id 401879286 in that span.', '', D])
  })

  for (const [label, a] of [
    ['an Error', new Error('timeout')],
    ['a non-zero exit', { stdout: answer(), exitCode: 1 }],
    ['a cut stdout', { stdout: answer(), truncated: true }],
    ['not JSON', 'Error: something'],
    ['two JSON values', `${answer()}\n${answer()}`],
  ] as const) {
    test(`a failed first read (${label}): "The CLI gave no answer." alone`, async ($, on) => {
      const w = await world($, on, [live(2, 1)], { matchAnswers: [a] })
      await w.command('match')
      expect(await texts(await w.mountPane())).toEqual([FAILED])
    })
  }

  for (const [label, body] of [
    ['no lines (a CLI before #177)', JSON.stringify({ degraded: false, match: null, source: null })],
    ['lines not an array', answer({ lines: 'Arsenal 2–1 Chelsea' })],
    ['a line that is not a string', answer({ lines: ['Arsenal 2–1 Chelsea', 7] })],
    ['the first-run object', JSON.stringify({ competition: null, noCompetition: true })],
  ] as const) {
    test(`an answer this plugin does not read (${label}): the no-view sentence alone`, async ($, on) => {
      const w = await world($, on, [live(2, 1)], { matchAnswers: [body] })
      await w.command('match')
      expect(await texts(await w.mountPane())).toEqual([NO_VIEW])
    })
  }

  test('bounded: at most 150 lines, each cut at 600 characters; the attribution and the disclaimer each at 1,000', async ($, on) => {
    const many = Array.from({ length: 200 }, (_, i) => `row ${i}`)
    many[3] = 'x'.repeat(2_000)
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer({ lines: many, attribution: 'a'.repeat(3_000), disclaimer: 'd'.repeat(3_000) })] })
    await w.command('match')
    const t = await texts(await w.mountPane())
    expect(t).toHaveLength(150 + 3)
    expect(t[3]).toHaveLength(600)
    expect(t[149]).toBe('row 149')
    expect(t.at(-2)).toHaveLength(1_000)
    expect(t.at(-1)).toHaveLength(1_000)
  })
})

describe('re-reading it while open', () => {
  test("a band run's current view with the bound match's score changed: one re-read; the same score again: none", async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), live(3, 1)], { matchAnswers: [answer(), answer({ lines: ['Arsenal 3–1 Chelsea'] }, { score: { home: 3, away: 1 } })] })
    await w.command('match')
    expect(w.matchRuns()).toHaveLength(1)
    await w.clock.advance(15_000) // the band sees 3–1: one re-read
    expect(w.matchRuns()).toHaveLength(2)
    await w.clock.advance(15_000) // 3–1 again
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(2)
    expect((await texts(await w.mountPane()))[0]).toBe('Arsenal 3–1 Chelsea')
  })

  test('the change is against the band\'s previous observation, seeded by the open\'s reading: the first band run after the open, already changed, re-reads', async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), live(2, 2)], { matchAnswers: [answer()] })
    await w.command('match')
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(2)
  })

  test('a shootout tally changing is a change', async ($, on) => {
    const so = (h: number) => live(1, 1, { live: { items: [{ id: ID, line: 'x', score: { home: 1, away: 1 }, shootout: { home: h, away: 0 } }], total: 1, shown: 1, truncated: false, complete: true } })
    const w = await world($, on, [so(1), so(1), so(2)], { matchAnswers: [answer()] })
    await w.command('match')
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(2)
  })

  test('a view that is not current says nothing: a changed score there re-reads nothing', async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), live(3, 1, { current: false })], { matchAnswers: [answer()] })
    await w.command('match')
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(1)
  })

  test('a view of another competition (the person followed another): nothing re-read from it', async ($, on) => {
    const other = live(3, 1, { competition: { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'saved' } })
    const w = await world($, on, [live(2, 1), live(2, 1), other], { matchAnswers: [answer()] })
    await w.command('match')
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(1)
  })

  test('the bound match leaving a current view\'s live list (full time): one re-read', async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), nothingLive()], { matchAnswers: [answer(), finished()] })
    await w.command('match')
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(2)
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(2)
  })

  test('a scheduled match entering a current view\'s live list (kickoff seen by the band): one re-read', async ($, on) => {
    const kickoff = new Date(NOW + 60 * 60_000).toISOString()
    const w = await world($, on, [upcoming(kickoff), upcoming(kickoff), live(0, 0)], { matchAnswers: [scheduled(kickoff), answer()] })
    await w.command('match')
    await w.clock.advance(15_000)
    expect(w.matchRuns()).toHaveLength(2)
  })

  test('a scheduled match: no re-read before its kickoff, one at it (whatever the band follows)', { timeoutMs: 20_000 }, async ($, on) => {
    const kickoff = new Date(NOW + 10 * 60_000).toISOString()
    const laliga = view('BAR vs RMA in 2d', { current: true, staleAfter: STALE_AFTER, competition: { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'saved' } })
    const w = await world($, on, [upcoming(kickoff), upcoming(kickoff), laliga], { matchAnswers: [scheduled(kickoff), answer()] })
    await w.command('match')
    await w.clock.advance(10 * 60_000 - 2_000)
    expect(w.matchRuns()).toHaveLength(1)
    await w.clock.advance(3_000)
    expect(w.matchRuns()).toHaveLength(2)
    expect(w.matchRuns()[1]).toEqual(['claudinho', 'match', ID, '--json', '--competition', 'eng.1'])
  })

  test('in play: a re-read every 2 minutes with no other trigger', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
    await w.command('match')
    await w.clock.advance(119_000)
    expect(w.matchRuns()).toHaveLength(1)
    await w.clock.advance(2_000)
    expect(w.matchRuns()).toHaveLength(2)
    await w.clock.advance(120_000)
    expect(w.matchRuns()).toHaveLength(3)
  })

  test('half-time keeps the 2-minute re-read', { timeoutMs: 20_000 }, async ($, on) => {
    const ht = answer({}, { status: 'HT' })
    const w = await world($, on, [live(2, 1)], { matchAnswers: [ht] })
    await w.command('match')
    await w.clock.advance(121_000)
    expect(w.matchRuns()).toHaveLength(2)
  })

  for (const [label, final] of [
    ['FT', finished()],
    ['FT, degraded', answer({ degraded: true }, { status: 'FT' })],
    ['FT, partial', answer({ partial: { omitted: 1 } }, { status: 'FT' })],
    ['POSTPONED', answer({}, { status: 'POSTPONED', score: undefined })],
    ['CANCELLED', answer({}, { status: 'CANCELLED', score: undefined })],
  ] as const) {
    test(`after a final answer (${label}): no more re-reads, from the timer or the band`, { timeoutMs: 20_000 }, async ($, on) => {
      const w = await world($, on, [live(2, 1), live(2, 1), live(4, 1)], { matchAnswers: [final] })
      await w.command('match')
      await w.clock.advance(15_000)
      await w.clock.advance(300_000)
      expect(w.matchRuns()).toHaveLength(1)
    })
  }

  test('a failed re-read keeps the last rows under the refresh-failed row; the next good read clears it', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer(), new Error('timeout'), answer({ lines: ['Arsenal 3–1 Chelsea'] })] })
    await w.command('match')
    await w.clock.advance(121_000)
    expect(await texts(await w.mountPane())).toEqual([REFRESH_FAILED, ...ROWS, '', A, D])
    await w.clock.advance(120_000) // a failed read keeps the 2-minute re-read
    expect(await texts(await w.mountPane())).toEqual(['Arsenal 3–1 Chelsea', '', A, D])
  })

  test('a failed first read keeps the 2-minute re-read', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [new Error('timeout'), answer()] })
    await w.command('match')
    await w.clock.advance(121_000)
    expect(w.matchRuns()).toHaveLength(2)
    expect(await texts(await w.mountPane())).toEqual([...ROWS, '', A, D])
  })

  test('never two reads in flight: triggers during a held read are kept once', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), live(3, 1), live(4, 1), live(5, 1)], { matchAnswers: [answer(), held(answer()), answer(), answer()] })
    await w.command('match')
    await w.clock.advance(15_000) // 3–1: a re-read, held
    await w.clock.advance(15_000) // 4–1 while it is held
    await w.clock.advance(15_000) // 5–1 while it is held
    expect(w.matchRuns()).toHaveLength(2)
    await w.release()
    await w.clock.advance(1)
    expect(w.matchRuns()).toHaveLength(3)
  })
})

describe('closing and reopening it', () => {
  test('closed: no re-read from the band or the timer', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), live(3, 1)], { matchAnswers: [answer()] })
    await w.command('match')
    await w.closePane()
    await w.clock.advance(15_000)
    await w.clock.advance(240_000)
    expect(w.matchRuns()).toHaveLength(1)
  })

  test('a read in flight when the pane closes writes nothing into the pane reopened after it', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [live(2, 1), live(2, 1), live(3, 1), live(3, 1)], {
      matchAnswers: [answer(), held(answer({ lines: ['OLD'] })), answer({ lines: ['NEW'] })],
    })
    await w.command('match')
    await w.clock.advance(15_000) // a re-read, held
    await w.closePane()
    await w.command('match') // reopen: its own read
    await w.release() // the old read answers late
    expect(await texts(await w.mountPane())).toEqual(['NEW', '', A, D])
  })

  test('/claudinho match while open rebinds the same pane: a new ambient read, one pane id', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer(), answer({ lines: ['SECOND'] })] })
    await w.command('match')
    await w.command('match')
    expect(w.argvs.filter((a) => a[1] === 'ambient').length).toBeGreaterThanOrEqual(3)
    expect(w.opens.map((o) => o.id)).toEqual(['match', 'match'])
    expect(await texts(await w.mountPane())).toEqual(['SECOND', '', A, D])
  })
})

describe('the rest unchanged', () => {
  test('the band still draws its line while the pane is open', async ($, on) => {
    const w = await world($, on, [live(2, 1)], { matchAnswers: [answer()] })
    await w.command('match')
    const band = await w.mount()
    expect((await band.findAll({ type: 'Text' })).map((t) => t.text)).toContain(LINE)
  })
})
