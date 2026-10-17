import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, BARE_PATH, HOME, drawnRows, finishedRecord, liveRecord, momentLine, momentView, toastTexts, view, world } from './world'

/**
 * The plugin's moments and band in the reader's language (plugin 0.6.0; the design packet's C3 to C7):
 * - the option `language`: `auto` (the default), `en`, `es`, `pt`, `fr`; any other value is `auto`. `auto` is the
 *   CLI's `pickLang` predicate on the HOST's environment: `CLAUDINHO_LANG`, then `LANG`'s language part
 *   (`es_MX.UTF-8` gives `es`), each tried only when it is one of the four (case-sensitive; an empty value
 *   skipped), else `en`. The plugin passes `--lang <code>` (one of the four) appended to every CLI run: the band's
 *   `ambient --json --columns N`, the `/claudinho` reply's `ambient --json`, and `match <id> --json`;
 * - the moments are composed from the view's `words` (CLI 0.12.0: the ten words, templates), in the grammar the
 *   plugin ships (every branch), `{team}` filled by one LITERAL replacement with the record's `names`; English with
 *   the English words is byte-identical to today's on every branch;
 * - a view without `words`, or whose `words` cannot be read whole (each of the ten a string of at most 40
 *   characters; `goalFor` and `win` holding `{team}` exactly once, the others none), uses today's English words for
 *   every moment together; a record without `names` stays on the legacy path (its own `line`, the English banner);
 * - the mascot celebration prints `words.goal` whole on every frame; a goal play keeps the words it was built with,
 *   a full-time play keeps its RESULT as evidence (`{ winner }`) apart from the words it draws, so a later view in
 *   another language, or with the English fallback, never drops an unchanged result; a corrected or unestablished
 *   result still does.
 */
type Lang = 'en' | 'es' | 'pt' | 'fr'
type Words = Record<string, string>
const WORDS: Record<Lang, Words> = {
  en: { goal: 'GOAL!', ownGoal: 'Own goal', ownGoalDetail: 'own goal', goalFor: 'Goal for {team}', goals: 'Goals', scoreUpdated: 'Score updated', penalties: 'Penalties', fullTime: 'Full time', win: '{team} win', draw: 'Draw' },
  es: { goal: '¡GOL!', ownGoal: 'Gol en contra', ownGoalDetail: 'gol en contra', goalFor: 'Gol de {team}', goals: 'Goles', scoreUpdated: 'Marcador corregido', penalties: 'Penales', fullTime: 'Final', win: 'Gana {team}', draw: 'Empate' },
  pt: { goal: 'GOL!', ownGoal: 'Gol contra', ownGoalDetail: 'gol contra', goalFor: 'Gol · {team}', goals: 'Gols', scoreUpdated: 'Placar corrigido', penalties: 'Pênaltis', fullTime: 'Fim de jogo', win: '{team} vence', draw: 'Empate' },
  fr: { goal: 'BUT !', ownGoal: 'But contre son camp', ownGoalDetail: 'contre son camp', goalFor: 'But pour {team}', goals: 'Buts', scoreUpdated: 'Score corrigé', penalties: 'Tirs au but', fullTime: 'Fin du match', win: '{team} gagne', draw: 'Match nul' },
}
/** A template filled literally (no replacement syntax read in the team's name). */
const fill = (template: string, team: string) => template.split('{team}').join(team)
/** The view's language fields as the CLI prints them for `lang`. */
const said = (lang: Lang, over: Record<string, unknown> = {}) => ({ lang, words: WORDS[lang], ...over })

type W = Awaited<ReturnType<typeof world>>
const next = async (w: W) => {
  await w.clock.advance(15_000)
}
const rows = async (w: W, props: Record<string, unknown> = {}) => (await drawnRows(await w.mount(props))).map((r) => r.trim())
const hasMascot = (r: string[]) => r.some((x) => x.includes('▐▛███▜▌') || x.includes('▝▜█████▛▘'))

const OG_FOR = { type: 'OWN_GOAL', minute: 63, side: 'away', teamCode: 'LIV', player: 'Philipp Ziereis' }
const OG_AGAINST = { type: 'OWN_GOAL', minute: 63, side: 'home', teamCode: 'LAS', player: 'Virgil van Dijk' }
const LJUBICIC = { type: 'GOAL', minute: 63, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
const SALAH_PEN = { type: 'PEN', minute: 30, side: 'away', teamCode: 'LIV', player: 'Mohamed Salah' }
const pens = (h: number, a: number) => liveRecord([1, 1], { minute: 120, shootout: { home: h, away: a } })

/**
 * Every branch of the shipped grammar (C4): the two records the toast compares, and the toast it says, built from
 * the words. The English rows are today's toasts verbatim (moments.test.tsx).
 */
type Branch = {
  name: string
  before: [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
  after: [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
  toast: (w: Words) => string
  english: string
}
const BRANCHES: Branch[] = [
  {
    name: 'your goal, scorer and minute',
    before: [[liveRecord([0, 0])], []],
    after: [[liveRecord([0, 1], { lastGoal: ARAUJO })], []],
    toast: (w) => `⚽ ${w.goal} Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool`,
    english: "⚽ GOAL! Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool",
  },
  {
    name: 'your goal, a penalty (it stays on the goal branches)',
    before: [[liveRecord([0, 0])], []],
    after: [[liveRecord([0, 1], { lastGoal: SALAH_PEN })], []],
    toast: (w) => `⚽ ${w.goal} Liverpool · Mohamed Salah 30' · LASK Linz 0–1 Liverpool`,
    english: "⚽ GOAL! Liverpool · Mohamed Salah 30' · LASK Linz 0–1 Liverpool",
  },
  {
    name: 'your goal, no scorer: the clock minute',
    before: [[liveRecord([0, 0], { minute: 60 })], []],
    after: [[liveRecord([0, 1], { minute: 60 })], []],
    toast: (w) => `⚽ ${w.goal} Liverpool 60' · LASK Linz 0–1 Liverpool`,
    english: "⚽ GOAL! Liverpool 60' · LASK Linz 0–1 Liverpool",
  },
  {
    name: 'your goal, no minute',
    before: [[liveRecord([0, 0], { minute: undefined })], []],
    after: [[liveRecord([0, 1], { minute: undefined })], []],
    toast: (w) => `⚽ ${w.goal} Liverpool · LASK Linz 0–1 Liverpool`,
    english: '⚽ GOAL! Liverpool · LASK Linz 0–1 Liverpool',
  },
  {
    name: 'an own goal for you',
    before: [[liveRecord([1, 1], { minute: 64 })], []],
    after: [[liveRecord([1, 2], { minute: 64, lastGoal: OG_FOR })], []],
    toast: (w) => `⚽ ${w.ownGoal} · Liverpool 63' · LASK Linz 1–2 Liverpool`,
    english: "⚽ Own goal · Liverpool 63' · LASK Linz 1–2 Liverpool",
  },
  {
    name: 'against you, a scorer',
    before: [[liveRecord([0, 1], { minute: 64 })], []],
    after: [[liveRecord([1, 1], { minute: 64, lastGoal: LJUBICIC })], []],
    toast: (w) => `${fill(w.goalFor as string, 'LASK Linz')} · Robert Ljubicic 63' · LASK Linz 1–1 Liverpool`,
    english: "Goal for LASK Linz · Robert Ljubicic 63' · LASK Linz 1–1 Liverpool",
  },
  {
    name: 'against you, an own goal',
    before: [[liveRecord([0, 1], { minute: 64 })], []],
    after: [[liveRecord([1, 1], { minute: 64, lastGoal: OG_AGAINST })], []],
    toast: (w) => `${fill(w.goalFor as string, 'LASK Linz')} · ${w.ownGoalDetail} 63' · LASK Linz 1–1 Liverpool`,
    english: "Goal for LASK Linz · own goal 63' · LASK Linz 1–1 Liverpool",
  },
  {
    name: 'against you, no scorer: the clock minute after a space',
    before: [[liveRecord([0, 1], { minute: 60 })], []],
    after: [[liveRecord([1, 1], { minute: 60 })], []],
    toast: (w) => `${fill(w.goalFor as string, 'LASK Linz')} 60' · LASK Linz 1–1 Liverpool`,
    english: "Goal for LASK Linz 60' · LASK Linz 1–1 Liverpool",
  },
  {
    name: 'against you, no minute',
    before: [[liveRecord([0, 1], { minute: undefined })], []],
    after: [[liveRecord([1, 1], { minute: undefined })], []],
    toast: (w) => `${fill(w.goalFor as string, 'LASK Linz')} · LASK Linz 1–1 Liverpool`,
    english: 'Goal for LASK Linz · LASK Linz 1–1 Liverpool',
  },
  {
    name: 'goals (more than one)',
    before: [[liveRecord([0, 1])], []],
    after: [[liveRecord([1, 2])], []],
    toast: (w) => `${w.goals} · LASK Linz 1–2 Liverpool`,
    english: 'Goals · LASK Linz 1–2 Liverpool',
  },
  {
    name: 'score updated (a tally that fell)',
    before: [[liveRecord([0, 1], { lastGoal: ARAUJO })], []],
    after: [[liveRecord([0, 0])], []],
    toast: (w) => `${w.scoreUpdated} · LASK Linz 0–0 Liverpool`,
    english: 'Score updated · LASK Linz 0–0 Liverpool',
  },
  {
    name: 'penalties (a shootout tally that rose)',
    before: [[pens(3, 3)], []],
    after: [[pens(3, 4)], []],
    toast: (w) => `${w.penalties} · LASK Linz 1(3)–1(4) Liverpool`,
    english: 'Penalties · LASK Linz 1(3)–1(4) Liverpool',
  },
  {
    name: 'full time, a win',
    before: [[liveRecord([3, 6], { minute: 90 })], []],
    after: [[], [finishedRecord([3, 6])]],
    toast: (w) => `${w.fullTime} · LASK Linz 3–6 Liverpool · ${fill(w.win as string, 'Liverpool')}`,
    english: 'Full time · LASK Linz 3–6 Liverpool · Liverpool win',
  },
  {
    name: 'full time, a draw',
    before: [[liveRecord([2, 2], { minute: 90 })], []],
    after: [[], [finishedRecord([2, 2])]],
    toast: (w) => `${w.fullTime} · LASK Linz 2–2 Liverpool · ${w.draw}`,
    english: 'Full time · LASK Linz 2–2 Liverpool · Draw',
  },
  {
    name: 'full time, no result established',
    before: [[liveRecord([0, 0], { minute: 90 })], []],
    after: [[], [finishedRecord(null)]],
    toast: (w) => `${w.fullTime} · LASK Linz vs Liverpool`,
    english: 'Full time · LASK Linz vs Liverpool',
  },
]

describe('every toast branch in the view\'s language', () => {
  for (const lang of ['es', 'pt', 'fr'] as const) {
    for (const b of BRANCHES) {
      test(`${lang}: ${b.name}`, async ($, on) => {
        const texts = toastTexts(on)
        const w = await world($, on, [momentView(b.before[0], b.before[1], said(lang)), momentView(b.after[0], b.after[1], said(lang))])
        await next(w)
        expect(texts).toEqual([b.toast(WORDS[lang])])
      })
    }
  }
})

describe("English words: every branch byte-identical to today's", () => {
  for (const b of BRANCHES) {
    test(`en words: ${b.name}`, async ($, on) => {
      const texts = toastTexts(on)
      const w = await world($, on, [momentView(b.before[0], b.before[1], said('en')), momentView(b.after[0], b.after[1], said('en'))])
      await next(w)
      expect(texts).toEqual([b.english])
      expect(b.toast(WORDS.en)).toBe(b.english)
    })
  }

  test('a goal and full time in the same read, Spanish: the goal toast, then full time, both in Spanish', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([3, 5], { minute: 90 })], [], said('es')), momentView([], [finishedRecord([3, 6])], said('es'))])
    await next(w)
    expect(texts).toEqual(["⚽ ¡GOL! Liverpool 90' · LASK Linz 3–6 Liverpool", 'Final · LASK Linz 3–6 Liverpool · Gana Liverpool'])
  })
})

describe('{team} is filled literally, once', () => {
  for (const team of ['A$&B', "C$'D$`E", 'Real {team}']) {
    test(`a name holding ${JSON.stringify(team)}: a goal against and a full-time win read it as typed`, async ($, on) => {
      const texts = toastTexts(on)
      const names = { home: team, away: 'Liverpool' }
      const w = await world($, on, [
        momentView([liveRecord([0, 1], { minute: 60, names })], [], said('es')),
        momentView([liveRecord([1, 1], { minute: 60, names })], [], said('es')),
        momentView([liveRecord([2, 1], { minute: 90, names })], [], said('es')),
        momentView([], [finishedRecord([2, 1], { names })], said('es')),
      ])
      await next(w)
      await next(w)
      await next(w)
      expect(texts).toEqual([
        `Gol de ${team} 60' · ${team} 1–1 Liverpool`,
        `Gol de ${team} 90' · ${team} 2–1 Liverpool`,
        `Final · ${team} 2–1 Liverpool · Gana ${team}`,
      ])
    })
  }
})

describe('words the plugin cannot read whole: today\'s English for every moment (C6)', () => {
  const ENGLISH_GOAL = "⚽ GOAL! Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool"
  const goalRun = (words: unknown) => [
    momentView([liveRecord([0, 0])], [], { lang: 'es', words }),
    momentView([liveRecord([0, 1], { lastGoal: ARAUJO })], [], { lang: 'es', words }),
  ]
  const without = (key: string) => {
    const { [key]: _gone, ...rest } = WORDS.es
    return rest
  }
  const cases: Array<[string, unknown]> = [
    ['no `words` at all', undefined],
    ['`words` null', null],
    ['`words` a string', 'es'],
    ['`words` an array', Object.values(WORDS.es)],
    ['a field missing (draw), another moment\'s', without('draw')],
    ['a field missing (goal), the moment\'s own', without('goal')],
    ['a field of the wrong type (goals a number)', { ...WORDS.es, goals: 5 }],
    ['a field of the wrong type (fullTime null)', { ...WORDS.es, fullTime: null }],
    ['a 41-character value', { ...WORDS.es, scoreUpdated: 'x'.repeat(41) }],
    ['goalFor without {team}', { ...WORDS.es, goalFor: 'Gol de' }],
    ['goalFor with two {team}', { ...WORDS.es, goalFor: '{team} gol de {team}' }],
    ['win without {team}', { ...WORDS.es, win: 'Gana' }],
    ['a {team} where none is read (goal)', { ...WORDS.es, goal: '¡GOL! {team}' }],
    ['a {team} where none is read (draw)', { ...WORDS.es, draw: 'Empate {team}' }],
  ]
  for (const [label, words] of cases) {
    test(`${label}: the goal toast is today's English`, async ($, on) => {
      const texts = toastTexts(on)
      const w = await world($, on, goalRun(words))
      await next(w)
      expect(texts).toEqual([ENGLISH_GOAL])
    })
  }

  test('a broken field elsewhere: full time is today\'s English too (the words fall back together)', async ($, on) => {
    const texts = toastTexts(on)
    const words = { ...WORDS.es, goal: 'x'.repeat(41) }
    const w = await world($, on, [momentView([liveRecord([3, 6], { minute: 90 })], [], { lang: 'es', words }), momentView([], [finishedRecord([3, 6])], { lang: 'es', words })])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 3–6 Liverpool · Liverpool win'])
  })

  test('a value of exactly 40 characters is read: the moment is in the view\'s words', async ($, on) => {
    const texts = toastTexts(on)
    const goals = 'G'.repeat(40)
    const w = await world($, on, [momentView([liveRecord([0, 1])], [], { lang: 'es', words: { ...WORDS.es, goals } }), momentView([liveRecord([1, 2])], [], { lang: 'es', words: { ...WORDS.es, goals } })])
    await next(w)
    expect(texts).toEqual([`${goals} · LASK Linz 1–2 Liverpool`])
  })

  test('a record without `names` (CLI 0.11.2) stays on the legacy toast, its own line, whatever the words', async ($, on) => {
    const texts = toastTexts(on)
    const older = (score: [number, number]) => {
      const { names: _n, pinnedSide: _p, ...rest } = liveRecord(score)
      return rest
    }
    const w = await world($, on, [momentView([older([0, 0])], [], said('es')), momentView([older([0, 1])], [], said('es'))])
    await next(w)
    expect(texts).toEqual(["⚽ LASK Linz 0–1 Liverpool (23')"])
  })
})

describe('the celebrations in the view\'s language (C5)', () => {
  const before = (lang: Lang) => momentView([liveRecord([0, 0])], [], said(lang))
  const goal = (lang: Lang) => momentView([liveRecord([0, 1], { lastGoal: ARAUJO })], [], said(lang))
  const LINE = momentLine([0, 1])

  for (const [lang, word] of [['es', '¡GOL!'], ['pt', 'GOL!'], ['fr', 'BUT !']] as const) {
    test(`${lang}: the mascot's middle row is \`${word} Liverpool\` on every frame, the word whole, bold, in success`, { timeoutMs: 20_000 }, async ($, on) => {
      const w = await world($, on, [before(lang), goal(lang), goal(lang)])
      await next(w)
      for (let f = 0; f < 6; f++) {
        const r = await rows(w)
        expect(hasMascot(r), `frame ${f}`).toBe(true)
        expect(r[1], `frame ${f}`).toContain(`${word} Liverpool`)
        await w.clock.advance(500)
      }
    })

    test(`${lang}: the goal word's Text is \`${word}\`, bold, in the theme's success colour`, async ($, on) => {
      const w = await world($, on, [before(lang), goal(lang), goal(lang)])
      await next(w)
      const t = await (await w.mount()).findAll({ type: 'Text' })
      expect(t.some((x) => x.text.trim() === word && x.props.bold === true && x.props.color === 'success')).toBe(true)
    })
  }

  test('es, two spare rows: the words alone', async ($, on) => {
    const w = await world($, on, [before('es'), goal('es'), goal('es')])
    await next(w)
    expect(await rows(w, { maxRows: 4 })).toEqual(['¡GOL! Liverpool', "Ronald Araújo 22'", LINE])
  })

  test("es, one spare row: `¡GOL! Liverpool 22'`", async ($, on) => {
    const w = await world($, on, [before('es'), goal('es'), goal('es')])
    await next(w)
    expect(await rows(w, { maxRows: 3 })).toEqual(["¡GOL! Liverpool 22'", LINE])
  })

  test("es, an own goal for the pinned side: the bottom row is the filled detail, `gol en contra 63'`", async ($, on) => {
    const after = momentView([liveRecord([1, 2], { minute: 64, lastGoal: OG_FOR })], [], said('es'))
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 64 })], [], said('es')), after, after])
    await next(w)
    const r = await rows(w)
    expect(r[1]).toContain('¡GOL! Liverpool')
    expect(r[2]?.endsWith("gol en contra 63'")).toBe(true)
  })

  test('en words: the mascot row is `GOAL! Liverpool`, as today', async ($, on) => {
    const w = await world($, on, [before('en'), goal('en'), goal('en')])
    await next(w)
    expect((await rows(w))[1]).toContain('GOAL! Liverpool')
  })

  const FT_LINE = 'LAS vs LIV in 6d'
  const liveFt = (lang: Lang | null, score: [number, number] = [3, 6]) => momentView([liveRecord(score, { minute: 90 })], [], lang ? said(lang) : {})
  const ft = (lang: Lang | null, score: [number, number] | null = [3, 6], over: Record<string, unknown> = {}) =>
    momentView([], [finishedRecord(score, over)], { line: FT_LINE, ...(lang ? said(lang) : {}) })

  test('es full time, a win: `Final · Gana Liverpool` beside the mascot', async ($, on) => {
    const w = await world($, on, [liveFt('es'), ft('es'), ft('es')])
    await next(w)
    const r = await rows(w)
    expect(hasMascot(r)).toBe(true)
    expect(r.some((x) => x.includes('Final · Gana Liverpool'))).toBe(true)
  })

  test('fr full time, a draw: `Fin du match · Match nul`', async ($, on) => {
    const w = await world($, on, [liveFt('fr', [2, 2]), ft('fr', [2, 2]), ft('fr', [2, 2])])
    await next(w)
    expect((await rows(w)).some((x) => x.includes('Fin du match · Match nul'))).toBe(true)
  })

  test('the legacy banner (records without names) stays the growing English GOAL!, whatever the words', { timeoutMs: 20_000 }, async ($, on) => {
    const older = (score: [number, number]) => {
      const { names: _n, pinnedSide: _p, ...rest } = liveRecord(score)
      return rest
    }
    const goalView = momentView([older([0, 1])], [], said('es'))
    const w = await world($, on, [momentView([older([0, 0])], [], said('es')), goalView, goalView])
    await next(w)
    const banner = ['G', 'GO', 'GOA', 'GOAL', 'GOAL!']
    for (const word of banner) {
      const t = (await (await w.mount()).findAll({ type: 'Text' })).map((x) => x.text)
      expect(t[1]).toBe(word)
      await w.clock.advance(500)
    }
  })

  test('a Spanish goal play keeps its words when a later view of the same score falls back to English', { timeoutMs: 20_000 }, async ($, on) => {
    const fallback = momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])
    const w = await world($, on, [before('es'), goal('es'), fallback, fallback])
    await w.turnStart()
    await next(w) // the goal, Spanish: held
    await w.clock.advance(13_800)
    await w.turnEnd() // it plays from 28.8 s
    expect((await rows(w))[1]).toContain('¡GOL! Liverpool')
    await w.clock.advance(1_200) // the run at 30 s: the same score, no words
    const r = await rows(w)
    expect(r[1]).toContain('¡GOL! Liverpool')
    expect(r.join('\n')).not.toContain('GOAL!')
  })

  test('a Spanish full-time play waiting out a turn draws Spanish first, and keeps drawing it after an English-fallback view of the same result', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [liveFt('es'), ft('es'), ft(null), ft(null)])
    await w.turnStart()
    await next(w) // full time, Spanish, Liverpool win: held
    await w.clock.advance(13_800)
    await w.turnEnd() // it plays from 28.8 s
    const first = await rows(w)
    expect(first.some((x) => x.includes('Final · Gana Liverpool'))).toBe(true)
    await w.clock.advance(1_200) // the run at 30 s: the same result, no words
    for (let t = 0; t < 3_000; t += 500) {
      const r = await rows(w)
      expect(hasMascot(r), `+${t} ms`).toBe(true)
      expect(r.some((x) => x.includes('Final · Gana Liverpool')), `+${t} ms`).toBe(true)
      expect(r.some((x) => x.includes('Full time')), `+${t} ms`).toBe(false)
      await w.clock.advance(500)
    }
  })

  test('a Spanish full-time play held through an English-fallback view of the same result: it plays in Spanish when the turn ends', async ($, on) => {
    const w = await world($, on, [liveFt('es'), ft('es'), ft(null), ft(null)])
    await w.turnStart()
    await next(w) // full time, Spanish: held
    await next(w) // the same result, no words
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(true)
    expect(r.some((x) => x.includes('Final · Gana Liverpool'))).toBe(true)
    expect(r.some((x) => x.includes('Full time'))).toBe(false)
  })

  test('a Spanish full-time play is dropped when the winner is corrected, even in a view with other words', { options: { toasts: 'all' } }, async ($, on) => {
    const w = await world($, on, [liveFt('es', [1, 1]), ft('es', [1, 1], { winnerCode: 'LIV' }), ft(null, [1, 1], { winnerCode: 'LAS' }), ft(null, [1, 1], { winnerCode: 'LAS' })])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(false)
    expect(r.some((x) => x.includes('Final') || x.includes('Full time'))).toBe(false)
  })

  test('a Spanish full-time play is dropped when the result becomes unestablished (a winnerCode naming neither side)', { options: { toasts: 'all' } }, async ($, on) => {
    const w = await world($, on, [liveFt('es', [1, 1]), ft('es', [1, 1], { winnerCode: 'LIV' }), ft('es', [1, 1], { winnerCode: 'XXX' }), ft('es', [1, 1], { winnerCode: 'XXX' })])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(false)
    expect(r.some((x) => x.includes('Final') || x.includes('Full time'))).toBe(false)
  })
})

/** The language every CLI run is handed (C3): `--lang <code>` appended, once. */
const BAND_ARGV = (lang: Lang) => ['claudinho', 'ambient', '--json', '--columns', '80', '--lang', lang]
const LINE = "⚽ ARS 2–1 CHE 50'"
const host = (vars: Record<string, string>) => ({ env: { PATH: BARE_PATH, HOME, ...vars } })

describe('the language option and `auto` (C3)', () => {
  const autoCases: Array<[string, Record<string, string>, Lang]> = [
    ['CLAUDINHO_LANG=es', { CLAUDINHO_LANG: 'es' }, 'es'],
    ['LANG=es_MX.UTF-8', { LANG: 'es_MX.UTF-8' }, 'es'],
    ['LANG=fr_FR.UTF-8', { LANG: 'fr_FR.UTF-8' }, 'fr'],
    ['CLAUDINHO_LANG=de with LANG=pt_BR.UTF-8: the first supported candidate', { CLAUDINHO_LANG: 'de', LANG: 'pt_BR.UTF-8' }, 'pt'],
    ['CLAUDINHO_LANG=pt over LANG=es_MX.UTF-8', { CLAUDINHO_LANG: 'pt', LANG: 'es_MX.UTF-8' }, 'pt'],
    ['CLAUDINHO_LANG empty with LANG=fr_FR.UTF-8: an empty value skipped', { CLAUDINHO_LANG: '', LANG: 'fr_FR.UTF-8' }, 'fr'],
    ['CLAUDINHO_LANG=ES: cased otherwise, not Spanish (the predicate is case-sensitive)', { CLAUDINHO_LANG: 'ES' }, 'en'],
    ['LANG=C: no language part of the four', { LANG: 'C' }, 'en'],
    ['both absent', {}, 'en'],
  ]
  for (const [label, vars, lang] of autoCases) {
    test(`auto (the default), ${label}: --lang ${lang}`, async ($, on) => {
      const w = await world($, on, [view(LINE)], host(vars))
      expect(w.argvs).toEqual([BAND_ARGV(lang)])
    })
  }

  test('auto set explicitly, LANG=es_MX.UTF-8: --lang es', { options: { language: 'auto' } }, async ($, on) => {
    const w = await world($, on, [view(LINE)], host({ LANG: 'es_MX.UTF-8' }))
    expect(w.argvs).toEqual([BAND_ARGV('es')])
  })

  for (const lang of ['en', 'es', 'pt', 'fr'] as const) {
    test(`language ${lang} on a host whose LANG is another: --lang ${lang}`, { options: { language: lang } }, async ($, on) => {
      const other = lang === 'es' ? 'fr' : 'es'
      const w = await world($, on, [view(LINE)], host({ CLAUDINHO_LANG: other, LANG: `${other}_XX.UTF-8` }))
      expect(w.argvs).toEqual([BAND_ARGV(lang)])
    })
  }

  for (const value of ['de', 'ES', '']) {
    test(`an unknown value ${JSON.stringify(value)} is auto: LANG=es_MX.UTF-8 gives --lang es`, { options: { language: value } }, async ($, on) => {
      const w = await world($, on, [view(LINE)], host({ LANG: 'es_MX.UTF-8' }))
      expect(w.argvs).toEqual([BAND_ARGV('es')])
    })
  }

  test('every band run carries it, the later ones at the drawn width too', async ($, on) => {
    const w = await world($, on, [view(LINE)], host({ LANG: 'pt_BR.UTF-8' }))
    await w.mount({ bodyColumns: 24 })
    await next(w)
    expect(w.argvs.at(-1)).toEqual(['claudinho', 'ambient', '--json', '--columns', '24', '--lang', 'pt'])
  })

  test('/claudinho: `ambient --json --lang <code>`', { options: { language: 'fr' } }, async ($, on) => {
    const w = await world($, on, [view(LINE)])
    await w.command()
    expect(w.argvs[1]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'fr'])
  })
})

describe('the match pane under a language (C3, C7)', () => {
  const ID = '401879286'
  const NOWISH = '2026-10-10T15:05:00.000Z'
  const liveView = view(LINE, {
    current: true,
    staleAfter: NOWISH,
    live: { items: [{ id: ID, line: "Arsenal 2–1 Chelsea (50')", score: { home: 2, away: 1 }, pinned: true, picked: true }], total: 1, shown: 1, truncated: false, complete: true },
  })
  const ROWS = ['Arsenal 2–1 Chelsea', '  Premier League', "  Sat 15:00  50'"]
  const answer = (slug = 'eng.1') =>
    JSON.stringify({
      degraded: false,
      match: { id: ID, status: 'LIVE', kickoff: '2026-10-10T14:10:00.000Z', score: { home: 2, away: 1 } },
      source: 'espn',
      lines: ROWS,
      attribution: 'Live data: ESPN',
      disclaimer: 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.',
      competition: { slug, alias: 'x', name: 'X', chosenBy: 'saved' },
    })

  test('/claudinho match: the ambient run and the match run each carry --lang pt; the 2-minute re-read too', { options: { language: 'pt' } }, async ($, on) => {
    const w = await world($, on, [liveView], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.argvs.slice(1, 3)).toEqual([
      ['claudinho', 'ambient', '--json', '--lang', 'pt'],
      ['claudinho', 'match', ID, '--json', '--lang', 'pt'],
    ])
    await w.clock.advance(120_000)
    expect(w.matchRuns().at(-1)).toEqual(['claudinho', 'match', ID, '--json', '--lang', 'pt'])
  })

  test('a pinned match read (an answer of another competition): `--competition <slug>`, then --lang appended', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView], { matchAnswers: [answer('esp.1'), answer()] })
    await w.command('match')
    expect(w.matchRuns()).toEqual([
      ['claudinho', 'match', ID, '--json', '--lang', 'es'],
      ['claudinho', 'match', ID, '--json', '--competition', 'eng.1', '--lang', 'es'],
    ])
  })

  test("the pane draws the CLI's rows as the CLI wrote them (the plugin translates nothing in it)", { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView], { matchAnswers: [answer()] })
    await w.command('match')
    const t = (await (await w.mountPane()).findAll({ type: 'Text' })).map((x) => x.text)
    for (const row of ROWS) expect(t).toContain(row)
  })
})
