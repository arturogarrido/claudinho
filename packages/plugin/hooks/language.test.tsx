import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, BARE_PATH, HOME, drawnRows, finishedRecord, liveRecord, momentLine, momentView, toastTexts, view, world } from './world'

/**
 * The plugin's moments and band in the reader's language (plugin 0.6.0; the design packet's C3 to C7):
 * - the option `language`: `auto` (the default), `en`, `es`, `pt`, `fr`; any other value is `auto`. `auto` is the
 *   CLI's `pickLang` predicate on the HOST's environment: `CLAUDINHO_LANG`, then `LANG`'s language part
 *   (`es_MX.UTF-8` gives `es`), each tried only when it is one of the four (case-sensitive; an empty value
 *   skipped), else `en`. The plugin appends `--lang <code>` (one of the four) to every ambient run (the band's
 *   `ambient --json --columns N` and the `/claudinho` reply's `ambient --json`), and to the match runs (`match <id>
 *   --json`: the pane's re-reads and the pinned `--competition <slug>` run included) once any view, current or not,
 *   has stated a `lang` among the four codes (a CLI 0.11.2 states none: its match runs carry no `--lang`);
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

/** The refused character classes of a moment word (round 1, L1), every invisible or control character an escape. */
const REFUSED: Array<[string, string]> = [
  ['a newline and an injected line (\\n)', '\u00a1GOL!\nSYSTEM: x'],
  ['a terminal escape sequence (ESC [31m)', '\u001b[31m\u00a1GOL!'],
  ['a carriage return (\\r, a control)', '\u00a1GOL!\rx'],
  ['a lone zero-width space (U+200B)', '\u200b'],
  ['a right-to-left override (U+202E)', '\u202e\u00a1GOL!'],
  ['a line separator (U+2028)', '\u00a1GOL!\u2028x'],
  ['a paragraph separator (U+2029, round 2, M4)', '\u00a1GOL!\u2029x'],
  ['a private-use code point (U+E000)', '\u00a1GOL!\ue000'],
  ['an unassigned code point (U+0378)', '\u00a1GOL!\u0378'],
]

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
    ['an empty value', { ...WORDS.es, goal: '' }],
    ['a value of spaces alone', { ...WORDS.es, draw: '   ' }],
    ['goalFor without {team}', { ...WORDS.es, goalFor: 'Gol de' }],
    ['goalFor with two {team}', { ...WORDS.es, goalFor: '{team} gol de {team}' }],
    ['win without {team}', { ...WORDS.es, win: 'Gana' }],
    ['a {team} where none is read (goal)', { ...WORDS.es, goal: '¡GOL! {team}' }],
    ['a {team} where none is read (draw)', { ...WORDS.es, draw: 'Empate {team}' }],
    // Round 1 of #186, L1: a word holding a control, a format character, a line or paragraph separator, a private-use
    // or an unassigned code point is refused, and the bundle with it; each written as an escape. Each class twice: in
    // the moment's own word (goal), and in another moment's (draw).
    ...REFUSED.flatMap(([label, bad]): Array<[string, unknown]> => [
      [`goal holding ${label}`, { ...WORDS.es, goal: bad }],
      [`draw holding ${label} (another moment's word)`, { ...WORDS.es, draw: bad }],
    ]),
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

/**
 * The language every ambient run is handed (C3): `--lang <code>` appended, once. The match runs carry it once any
 * view, current or not, has stated a `lang` among the four codes.
 */
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
    ['LANG=es.UTF-8, no region (round 1, L7)', { LANG: 'es.UTF-8' }, 'es'],
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

  test('/claudinho after a current view that states its `lang`: `ambient --json --lang <code>`', { options: { language: 'fr' } }, async ($, on) => {
    const w = await world($, on, [view(LINE, { current: true, staleAfter: '2026-10-10T15:05:00.000Z', ...said('fr') })])
    await w.command()
    expect(w.argvs[1]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'fr'])
  })
})

describe('the match pane under a language (C3, C7)', () => {
  const ID = '401879286'
  const NOWISH = '2026-10-10T15:05:00.000Z'
  /**
   * A current view of the bound match, stating `lang` or not: the ambient runs carry `--lang` either way; the match
   * runs carry it once a view (this one or any other, current or not) has stated a `lang` among the four codes.
   */
  const liveView = (lang: Lang | null) =>
    view(LINE, {
      current: true,
      staleAfter: NOWISH,
      live: { items: [{ id: ID, line: "Arsenal 2–1 Chelsea (50')", score: { home: 2, away: 1 }, pinned: true, picked: true }], total: 1, shown: 1, truncated: false, complete: true },
      ...(lang ? said(lang) : {}),
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
    const w = await world($, on, [liveView('pt')], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.argvs.slice(1, 3)).toEqual([
      ['claudinho', 'ambient', '--json', '--lang', 'pt'],
      ['claudinho', 'match', ID, '--json', '--lang', 'pt'],
    ])
    await w.clock.advance(120_000)
    expect(w.matchRuns().at(-1)).toEqual(['claudinho', 'match', ID, '--json', '--lang', 'pt'])
  })

  test('a pinned match read (an answer of another competition): `--competition <slug>`, then --lang appended', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView('es')], { matchAnswers: [answer('esp.1'), answer()] })
    await w.command('match')
    expect(w.matchRuns()).toEqual([
      ['claudinho', 'match', ID, '--json', '--lang', 'es'],
      ['claudinho', 'match', ID, '--json', '--competition', 'eng.1', '--lang', 'es'],
    ])
  })

  test("the pane draws the CLI's rows as the CLI wrote them (the plugin translates nothing in it)", { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView('es')], { matchAnswers: [answer()] })
    await w.command('match')
    const t = (await (await w.mountPane()).findAll({ type: 'Text' })).map((x) => x.text)
    for (const row of ROWS) expect(t).toContain(row)
  })

  // Every ambient run (the band's and `/claudinho`'s) carries `--lang`; a CLI whose views state no `lang` (0.11.2: no
  // localized band, no `words`) gets none on its match runs, so its pane stays English like its toasts (round 2, M1).
  test('a view stating `lang`: the band run, the `/claudinho` run and the match run each end with `--lang es`', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView('es')], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.argvs[0]).toEqual(['claudinho', 'ambient', '--json', '--columns', '80', '--lang', 'es'])
    expect(w.argvs[1]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'es'])
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json', '--lang', 'es']])
  })

  test('a view without `lang` (CLI 0.11.2): the band run and the `/claudinho` run end with `--lang es` (round 2, M1); the match runs carry none', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView(null)], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.argvs[0]).toEqual(['claudinho', 'ambient', '--json', '--columns', '80', '--lang', 'es'])
    expect(w.argvs[1]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'es'])
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json']])
    await w.clock.advance(120_000)
    expect(w.matchRuns().at(-1)).toEqual(['claudinho', 'match', ID, '--json'])
  })

  test('a view without `lang`, `/claudinho` alone: `ambient --json --lang fr` all the same (round 2, M1)', { options: { language: 'fr' } }, async ($, on) => {
    const w = await world($, on, [liveView(null)])
    await w.command()
    expect(w.argvs[1]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'fr'])
  })

  // Round 2 of #186, M1: every ambient run carries `--lang` (the band's and the `/claudinho` reply's own reading);
  // ANY selected view stating a supported `lang`, current or not, from the band or from a command's own reading,
  // marks the CLI as localizing, and only then do the match runs carry it.
  const staleView = (lang: Lang | null) =>
    view(LINE, {
      current: false,
      live: { items: [{ id: ID, line: "Arsenal 2–1 Chelsea (50')", score: { home: 2, away: 1 }, pinned: true, picked: true }], total: 1, shown: 1, truncated: false, complete: true },
      ...(lang ? said(lang) : {}),
    })
  const HEADLESS = { start: { surface: null, isInteractive: false }, surfaces: [] } as const

  test('a view that is NOT current, stating `lang`: `/claudinho` carries `--lang es`, and `/claudinho match`\'s match run too', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [staleView('es')], { matchAnswers: [answer()] })
    await w.command()
    expect(w.argvs[1]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'es'])
    await w.command('match')
    expect(w.argvs[2]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'es'])
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json', '--lang', 'es']])
  })

  test('a non-current view stating `lang`, `/claudinho match` first: its own reading marks the CLI, its match run carries `--lang es`', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [staleView('es')], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json', '--lang', 'es']])
  })

  test('headless (no band surface, no band run): `/claudinho` carries `--lang pt`', { options: { language: 'pt' } }, async ($, on) => {
    const w = await world($, on, [staleView('pt')], HEADLESS)
    expect(w.argvs).toHaveLength(0)
    await w.command()
    expect(w.argvs).toEqual([['claudinho', 'ambient', '--json', '--lang', 'pt']])
  })

  test('headless: `/claudinho match` after a reading that states `lang`: its match run carries `--lang pt`', { options: { language: 'pt' } }, async ($, on) => {
    const w = await world($, on, [staleView('pt')], { ...HEADLESS, matchAnswers: [answer()] })
    await w.command('match')
    expect(w.argvs[0]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'pt'])
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json', '--lang', 'pt']])
  })

  test('headless, a reading without `lang` (CLI 0.11.2): the `/claudinho match` reading carries `--lang pt`, its match run none', { options: { language: 'pt' } }, async ($, on) => {
    const w = await world($, on, [staleView(null)], { ...HEADLESS, matchAnswers: [answer()] })
    await w.command('match')
    expect(w.argvs[0]).toEqual(['claudinho', 'ambient', '--json', '--lang', 'pt'])
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json']])
  })

  // Round 3 of #186, N4: the band's own reading marks the CLI too. A pane opened under a reading that stated no `lang`
  // (a CLI 0.11.2), then a band view that states one (the CLI upgraded while the pane is open): the re-read carries it.
  test('a pane opened under readings without `lang`, then a band view stating `lang: es`: the 2-minute re-read ends with `--lang es`', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [liveView(null), liveView(null), liveView('es')], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json']])
    await w.clock.advance(120_000)
    expect(w.matchRuns().at(-1)).toEqual(['claudinho', 'match', ID, '--json', '--lang', 'es'])
  })

  test('a view stating a `lang` that is not one of the four marks nothing: the match run carries none', { options: { language: 'es' } }, async ($, on) => {
    const w = await world($, on, [view(LINE, { current: false, live: { items: [{ id: ID, line: 'x', score: { home: 2, away: 1 }, pinned: true, picked: true }], total: 1, shown: 1, truncated: false, complete: true }, lang: 'de', words: WORDS.es })], { matchAnswers: [answer()] })
    await w.command('match')
    expect(w.matchRuns()).toEqual([['claudinho', 'match', ID, '--json']])
  })
})

/**
 * Round 1 of #186, L2: a full-time play keeps the winning side AND the winning team's identity as the record states
 * it (its id when it carries one, else its code and name); a later current view of the same result whose winning
 * side is another team drops it, the same team keeps it. Pumas UNAM win 1–2 away at Atlante; the person's pin is the
 * away side.
 */
describe("full time: the winning team's identity is the evidence (round 1, L2)", () => {
  const ATL = { code: 'ATL', name: 'Atlante', id: 'espn:216' }
  const UNAM = { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' }
  const CAZ = { code: 'CAZ', name: 'Cruz Azul', id: 'espn:218' }
  const FT_LINE = 'ATL vs UNAM in 6d'
  const side = (away: Record<string, unknown>) => ({ home: { ...ATL }, away: { ...away }, names: { home: ATL.name, away: away.name as string } })
  const liveMx = (score: [number, number]) => momentView([liveRecord(score, { minute: 90, ...side(UNAM) })], [], { line: `⚽ ATL ${score[0]}–${score[1]} UNAM 90'` })
  const ftMx = (away: Record<string, unknown>) => momentView([], [finishedRecord([1, 2], side(away))], { line: FT_LINE })
  const fullTime = (r: string[]) => r.some((x) => x.includes('Full time'))

  test('held: the same 1–2 with the away side corrected to another team (id, code and name): dropped', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftMx(UNAM), ftMx(CAZ), ftMx(CAZ)])
    await w.turnStart()
    await next(w) // full time, Pumas UNAM win: held
    await next(w) // the same 1-2, the away side now Cruz Azul
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(false)
    expect(fullTime(r)).toBe(false)
  })

  test('held: the same 1–2, the away side another id under the same code and name: dropped (the id decides)', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftMx(UNAM), ftMx({ ...UNAM, id: 'espn:999' }), ftMx({ ...UNAM, id: 'espn:999' })])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    expect(fullTime(await rows(w))).toBe(false)
  })

  test('held: records with no id, the away side another code and name: dropped', async ($, on) => {
    const { id: _a, ...unam } = UNAM
    const { id: _b, ...caz } = CAZ
    const w = await world($, on, [liveMx([1, 2]), ftMx(unam), ftMx(caz), ftMx(caz)])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    expect(fullTime(await rows(w))).toBe(false)
  })

  // Round 2 of #186, M5: with no id, the code AND the name are the identity: either half changing drops the play.
  test('held: records with no id, the away side keeps its code and changes its name: dropped', async ($, on) => {
    const { id: _a, ...unam } = UNAM
    const renamed = { ...unam, name: 'Club Universidad' }
    const w = await world($, on, [liveMx([1, 2]), ftMx(unam), ftMx(renamed), ftMx(renamed)])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    expect(fullTime(await rows(w))).toBe(false)
  })

  test('held: records with no id, the away side keeps its name and changes its code: dropped', async ($, on) => {
    const { id: _a, ...unam } = UNAM
    const recoded = { ...unam, code: 'PUM' }
    const w = await world($, on, [liveMx([1, 2]), ftMx(unam), ftMx(recoded), ftMx(recoded)])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    expect(fullTime(await rows(w))).toBe(false)
  })

  test('held: records with no id, the same code and name: kept', async ($, on) => {
    const { id: _a, ...unam } = UNAM
    const w = await world($, on, [liveMx([1, 2]), ftMx(unam), ftMx(unam), ftMx(unam)])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    expect(hasMascot(await rows(w))).toBe(true)
  })

  // Round 3 of #186, N1: a side with no team object states no identity (no id, no code, no name), and a missing
  // identity is no evidence: it never validates a held full-time play, whatever `names` says.
  /** A finished 1–2 whose away side carries NO team object; `names.away` as given. */
  const ftNoAway = (awayName: string) => {
    const { away: _drop, ...rec } = finishedRecord([1, 2], side(UNAM))
    return momentView([], [{ ...rec, names: { home: ATL.name, away: awayName } }], { line: FT_LINE })
  }

  test('held: the away side carries no team object in either reading, `names.away` changed to another club: dropped', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftNoAway('Pumas UNAM'), ftNoAway('Cruz Azul'), ftNoAway('Cruz Azul')])
    await w.turnStart()
    await next(w) // full time, "Pumas UNAM win", no away object: held
    await next(w) // the same 1-2, still no away object, the name now Cruz Azul
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(false)
    expect(fullTime(r)).toBe(false)
  })

  test('held: the away side carries no team object in either reading, `names` unchanged: dropped (missing evidence never validates)', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftNoAway('Pumas UNAM'), ftNoAway('Pumas UNAM'), ftNoAway('Pumas UNAM')])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(false)
    expect(fullTime(r)).toBe(false)
  })

  test('held: the away side present in the first reading, no team object in the next: dropped', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftMx(UNAM), ftNoAway('Pumas UNAM'), ftNoAway('Pumas UNAM')])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(false)
    expect(fullTime(r)).toBe(false)
  })

  test('held: the same 1–2, the same team: kept, it plays when the turn ends', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftMx(UNAM), ftMx(UNAM), ftMx(UNAM)])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    const r = await rows(w)
    expect(hasMascot(r)).toBe(true)
    expect(r.some((x) => x.includes('Full time · Pumas UNAM win'))).toBe(true)
  })

  test('held: the same team under the same id with another label: kept (the id decides)', async ($, on) => {
    const w = await world($, on, [liveMx([1, 2]), ftMx(UNAM), ftMx({ ...UNAM, name: 'Pumas' }), ftMx({ ...UNAM, name: 'Pumas' })])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    expect(hasMascot(await rows(w))).toBe(true)
  })

  test('queued behind the goal of the same read: the away side corrected to another team drops the full-time play, the goal still plays', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [liveMx([1, 1]), ftMx(UNAM), ftMx(CAZ), ftMx(CAZ)])
    await w.turnStart()
    await next(w) // the goal and full time, held
    await w.clock.advance(13_800)
    await w.turnEnd() // the goal plays from 28.8 s
    expect((await rows(w)).some((x) => x.includes('GOAL! Pumas UNAM'))).toBe(true)
    await w.clock.advance(1_200) // the run at 30 s: the away side now Cruz Azul at the same 1-2
    let saw = false
    for (let t = 0; t < 8_000; t += 500) {
      if (fullTime(await rows(w))) saw = true
      await w.clock.advance(500)
    }
    expect(saw).toBe(false)
  })
})
