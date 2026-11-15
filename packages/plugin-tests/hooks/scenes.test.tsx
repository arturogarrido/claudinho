import { describe, expect, test } from 'claude-code/testing'
import { TEAM_COLORS } from './team-colors'
import { buildLook } from './team-look'
import { boardCode, pitchSvg, pixelSvg, scarfName } from './team-scenes'
import { START, liveRecord, momentView, view, world } from './world'

/**
 * The team look's scenes (plugin 0.9.0): under `teamTheme: on`, `teamScene` chooses what is drawn behind the
 * conversation in the desktop and mobile apps: `band` (the default, 0.8.0's band, unchanged), `pitch` (faded pitch
 * lines and a small scarf with the team's name) or `pixel` (a stadium corner: terraces, fans, a goal, and a scoreboard
 * with the two teams' codes, never a score). The pixel corner has three states: `live` (the pinned team's match is in
 * play, by a current view), `idle` (an empty stadium, the next fixture's codes) and `goal` (the pinned side scored:
 * once per goal, for six seconds, then `live` again at the next reading).
 *
 * What the engine does with a scene, measured in the desktop app (anthropics/claude-code#109770, #110150), and so
 * what these cases refuse: `shape-rendering` and any `@media` rule but reduced motion freeze every animation; a
 * drawing whose source is unchanged is not drawn again (a goal's source differs per goal); a new drawing under an old
 * name can keep the old drawing (every set has a name no earlier set had).
 *
 * What an app paints is not asserted here: these cases pin the calls, the names and the SVG sources.
 */
const LINE = 'ARS vs LEE in 2d4h'
const DESKTOP = { start: { surface: 'desktop', isInteractive: true } } as const
const PITCH = { options: { teamTheme: 'on', teamScene: 'pitch' } }
const PIXEL = { options: { teamTheme: 'on', teamScene: 'pixel' } }
const ARSENAL = { pick: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }
const ARS = { main: 'ef0107', second: 'ffffff' } as const
const LIV = { main: 'c8102e', second: 'ffffff' } as const
const NEXT_ARS = { next: { id: '1', home: { code: 'ARS', name: 'Arsenal' }, away: { code: 'LEE', name: 'Leeds United' }, status: 'SCHEDULED' } }
const GOAL_MS = 6_000

type Kit$ = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type SetArgs = { colors: unknown; backdrop: { scene: string; glass: { blur: number; opacity: number } } }

/** The engine beneath: every theme set as it arrives (`deny(n)` refuses the nth, from 1), and every clear. */
const engine = (on: On, deny: (n: number) => boolean = () => false) => {
  const sets: SetArgs[] = []
  const clears: number[] = []
  on('theme.set', (_$, e) => {
    sets.push(JSON.parse(JSON.stringify(e)) as SetArgs)
    if (deny(sets.length)) return { deny: 'theme.set denied' }
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('theme.clear', () => {
    clears.push(1)
    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  return { sets, clears }
}

/** What our Backdrop hook draws for a scene name: the one Svg's source, or undefined when it draws none. */
const drawn = async ($: Kit$, scene: string, surface: 'desktop' | 'mobile' = 'desktop', plugin = 'claudinho') => {
  const svgs = await (
    await $.ui.mount({ plugin, surface, component: 'Backdrop', props: { scene, plugin, glass: { blur: 20, opacity: 0.5 } }, viewport: { columns: 100, rows: 30 } } as Parameters<typeof $.ui.mount>[0])
  ).findAll({ type: 'Svg' })
  expect(svgs.length).toBeLessThanOrEqual(1)
  return svgs[0]?.props.source as string | undefined
}
const sceneOf = (s: SetArgs | undefined) => (s as SetArgs).backdrop.scene
const colorsOf = (name: string | undefined, id?: string) => JSON.parse(JSON.stringify(buildLook(name, id === undefined ? undefined : TEAM_COLORS[id]).look.colors))
const NAME = /^(pitch|pixel)-[0-9a-z]+-[0-9]+$/
const stampOf = (source: string) => Number((/<desc>goal ([0-9]+)<\/desc>/.exec(source) ?? [])[1])

/** A current view with the moments' match live at `score` (LASK Linz v Liverpool, the pin Liverpool, away). */
const live = (score: [number, number], over: Record<string, unknown> = {}, viewOver: Record<string, unknown> = {}) => momentView([liveRecord(score, over)], [], viewOver)

// ── The drawings, as data ───────────────────────────────────────────────────────────────────────────────────────

/** Every tag closed in order, every attribute quoted, no bare `&`, no control character, no lone surrogate. */
const wellFormed = (svg: string): string | null => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what the checker refuses.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/.test(svg)) return 'a control character'
  for (let i = 0; i < svg.length; i += 1) {
    const c = svg.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = svg.charCodeAt(i + 1)
      if (!(d >= 0xdc00 && d <= 0xdfff)) return 'a lone high surrogate'
      i += 1
    } else if (c >= 0xdc00 && c <= 0xdfff) return 'a lone low surrogate'
  }
  if (/&(?!(amp|lt|gt|quot|apos);)/.test(svg)) return 'a bare &'
  const stack: string[] = []
  const tag = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_:][-A-Za-z0-9_:.]*="[^"<]*")*)\s*(\/?)>|<|>/g
  const styleless = svg.replace(/<style>[^<]*<\/style>/g, '<style></style>')
  for (let m = tag.exec(styleless); m !== null; m = tag.exec(styleless)) {
    if (m[2] === undefined) return `a stray ${m[0]} at ${m.index}`
    if (m[1] === '/') {
      if (stack.pop() !== m[2]) return `</${m[2]}> closes nothing at ${m.index}`
    } else if (m[4] !== '/') stack.push(m[2])
  }
  return stack.length === 0 ? null : `unclosed <${stack[stack.length - 1]}>`
}
/** What the engine would freeze, strip or refuse, and what a drawing must never hold. */
const refused = (svg: string): string[] => {
  const out: string[] = []
  if (svg.length >= 131_072) out.push('too long')
  if (/shape-rendering/i.test(svg)) out.push('shape-rendering')
  const css = [...svg.matchAll(/<style>([^<]*)<\/style>/g)].map((m) => m[1] as string).join('\n')
  for (const at of css.matchAll(/@[^{]*/g)) {
    const rule = at[0].trim()
    if (!/^@keyframes [a-z][a-z0-9-]*$/.test(rule) && rule !== '@media (prefers-reduced-motion:reduce)') out.push(rule)
  }
  if (/<\s*(script|foreignObject|image|a|animate|animateTransform|animateMotion|set|use|iframe)\b/i.test(svg)) out.push('a refused element')
  if (/\bhref\s*=/i.test(svg)) out.push('href')
  if (/\son[a-z]+\s*=/i.test(svg)) out.push('an event attribute')
  if (/url\((?!#)/i.test(svg)) out.push('a url that is no #id')
  if (/@import|expression\(|javascript:/i.test(svg)) out.push('a loader')
  return out
}
const ledRects = (svg: string) => ((/<g class="px-led"[^>]*>(.*?)<\/g>/s.exec(svg) ?? [])[1] ?? '').split('<rect').length - 1

describe('the drawings: what every one of them holds and never holds', () => {
  const all: Array<[string, string]> = [
    ['pitch', pitchSvg({ ...ARS, name: 'Arsenal' })],
    ['pitch, one color, no name', pitchSvg({ main: '1f7a3d' })],
    ['pixel live', pixelSvg({ ...ARS, state: 'live', home: 'ARS', away: 'LEE' })],
    ['pixel idle', pixelSvg({ ...ARS, state: 'idle', home: 'ARS', away: 'LEE' })],
    ['pixel idle, no fixture', pixelSvg({ main: '1f7a3d', state: 'idle' })],
    ['pixel goal', pixelSvg({ ...ARS, state: 'goal', home: 'ARS', away: 'LEE', stamp: 7 })],
  ]
  for (const [label, svg] of all) {
    test(`${label}: one well-formed svg, under the engine's limit, nothing the engine freezes or a drawing must not hold`, async () => {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(wellFormed(svg)).toBe(null)
      expect(refused(svg)).toEqual([])
    })
  }

  test('the checker itself: each thing it refuses turns it red', async () => {
    const ok = pixelSvg({ ...ARS, state: 'goal', home: 'ARS', away: 'LEE', stamp: 1 })
    expect(refused(ok)).toEqual([])
    expect(refused(ok.replace('<style>', '<style>rect{shape-rendering:crispEdges}'))).toEqual(['shape-rendering'])
    expect(refused(ok.replace('<style>', '<style>@media (min-aspect-ratio:1/1){.w{opacity:.9}}'))).toEqual(['@media (min-aspect-ratio:1/1)'])
    expect(refused(ok.replace('<style>', '<style>@media (prefers-reduced-motion:reduce) and (min-width:1px){.w{opacity:.9}}'))).toHaveLength(1)
    expect(refused(ok.replace('<style>', '<style>@media (prefers-color-scheme:light){.w{opacity:.9}}'))).toHaveLength(1)
    expect(refused(ok.replace('</svg>', '<script>1</script></svg>'))).toEqual(['a refused element'])
    expect(wellFormed(ok.replace('</svg>', '<g></svg>'))).not.toBe(null)
    expect(wellFormed(ok.replace('</svg>', '<desc>a & b</desc></svg>'))).toBe('a bare &')
  })

  test('a drawing is made of its two colors: both are in it, lower-cased, and a team with one color uses it for both', async () => {
    for (const svg of [pitchSvg({ main: '0A0B0C', second: '0D0E0F', name: 'X' }), pixelSvg({ main: '0A0B0C', second: '0D0E0F', state: 'live', home: 'A', away: 'B' })]) {
      expect(svg).toContain('#0a0b0c')
      expect(svg).toContain('#0d0e0f')
    }
    expect(pixelSvg({ main: '0a0b0c', state: 'live' })).toBe(pixelSvg({ main: '0a0b0c', second: '0a0b0c', state: 'live' }))
    expect(pitchSvg({ main: '0a0b0c', name: 'X' })).toBe(pitchSvg({ main: '0a0b0c', second: '0a0b0c', name: 'X' }))
  })

  test('colors that are not six hex digits draw pitch green, never the value given', async () => {
    const evil = '"/><script>'
    for (const svg of [pitchSvg({ main: evil, second: evil, name: 'X' }), pixelSvg({ main: evil, second: evil, state: 'live' })]) {
      expect(svg).not.toContain('script')
      expect(svg).toContain('#1f7a3d')
      expect(wellFormed(svg)).toBe(null)
    }
    expect(pixelSvg({ main: 'ef0107', second: 'nope', state: 'live' })).toBe(pixelSvg({ main: 'ef0107', state: 'live' }))
  })

  test('the same inputs draw the same source', async () => {
    expect(pitchSvg({ ...ARS, name: 'Arsenal' })).toBe(pitchSvg({ ...ARS, name: 'Arsenal' }))
    expect(pixelSvg({ ...ARS, state: 'goal', home: 'ARS', away: 'LEE', stamp: 3 })).toBe(pixelSvg({ ...ARS, state: 'goal', home: 'ARS', away: 'LEE', stamp: 3 }))
  })
})

describe('the pitch: the scarf carries the team\'s name, as text the drawing cannot be broken by', () => {
  test('scarfName: upper-cased, at most 18 code points, controls and lone surrogates dropped, never escaped twice', async () => {
    expect(scarfName('Pumas UNAM')).toBe('PUMAS UNAM')
    expect(scarfName('São Paulo')).toBe('SÃO PAULO')
    expect(scarfName('a'.repeat(30))).toBe('A'.repeat(18))
    expect([...scarfName(`${'a'.repeat(17)}😀😀`)]).toEqual([...'A'.repeat(17), '😀'])
    expect(scarfName('a\u0000b\u001fc\ud800d')).toBe('ABCD')
    // What XML cannot hold, and the other controls: dropped too.
    expect(scarfName('a\u007fb\u0085c\u009fd\ufffee\ufffff')).toBe('ABCDEF')
    expect(scarfName('  Arsenal  ')).toBe('ARSENAL')
    expect(scarfName('A&B')).toBe('A&B')
    for (const v of [undefined, null, 7, '', '   ', {}, ['x']]) expect(scarfName(v)).toBe('')
  })

  test('the name is in one text element, escaped; a name that is only markup stays text', async () => {
    const svg = pitchSvg({ ...ARS, name: 'A&B <c> "d"' })
    expect(svg).toContain('A&amp;B &lt;C&gt; &quot;D&quot;')
    expect(svg.split('<text').length - 1).toBe(1)
    expect(wellFormed(svg)).toBe(null)
    const cut = pitchSvg({ ...ARS, name: `${'a'.repeat(17)}&more` })
    expect(cut).toContain(`${'A'.repeat(17)}&amp;<`)
    expect(wellFormed(cut)).toBe(null)
    expect(wellFormed(pitchSvg({ ...ARS, name: 'a\u0000\ud800b' }))).toBe(null)
    expect(wellFormed(pitchSvg({ ...ARS, name: 'a\ufffe\uffff\u0085b' }))).toBe(null)
  })

  test('no name: the scarf carries no text', async () => {
    for (const name of [undefined, '', '  ']) expect(pitchSvg({ ...ARS, name })).not.toContain('<text')
  })

  test('the pitch never moves: no animation in it', async () => {
    expect(pitchSvg({ ...ARS, name: 'Arsenal' })).not.toMatch(/animation|@keyframes/)
  })
})

describe('the pixel corner: the board shows two codes and never a score', () => {
  test('boardCode: the letters, digits and & of a code, upper-cased, at most four; anything else is three dashes', async () => {
    expect(boardCode('UNAM')).toBe('UNAM')
    expect(boardCode('mty')).toBe('MTY')
    expect(boardCode('O&M')).toBe('O&M')
    expect(boardCode('S04')).toBe('S04')
    expect(boardCode('ABCDEF')).toBe('ABCD')
    expect(boardCode('É-X')).toBe('---')
    expect(boardCode('A B')).toBe('---')
    for (const v of [undefined, null, 7, '', '<b>', {}, '2–1']) expect(boardCode(v)).toBe('---')
  })

  test('the board is drawn in lit squares, more of them for more glyphs, none when there is no fixture', async () => {
    const base = { ...ARS, state: 'live' } as const
    expect(ledRects(pixelSvg({ ...base, home: 'ARS', away: 'LEE' }))).toBeGreaterThan(40)
    expect(ledRects(pixelSvg({ ...base, home: 'UNAM', away: 'MTY' }))).toBeGreaterThan(ledRects(pixelSvg({ ...base, home: 'I', away: 'I' })))
    expect(pixelSvg({ ...base, home: 'ARS', away: 'LEE' })).not.toBe(pixelSvg({ ...base, home: 'LEE', away: 'ARS' }))
    expect(ledRects(pixelSvg({ ...ARS, state: 'idle' }))).toBe(0)
    // One side unknown: the fixture is still shown, the unknown side as dashes.
    expect(pixelSvg({ ...base, home: 'ARS' })).toBe(pixelSvg({ ...base, home: 'ARS', away: '---' }))
    expect(pixelSvg({ ...base, home: 'ARS', away: '<x>' })).toBe(pixelSvg({ ...base, home: 'ARS', away: '---' }))
  })

  test('the codes reach the drawing as squares only: no text element, and a code is never copied in', async () => {
    const svg = pixelSvg({ ...ARS, state: 'live', home: 'QQQQ', away: 'ZZZZ' })
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('QQQQ')
    expect(svg).not.toContain('ZZZZ')
  })

  test('live has the crowd and the ball and no animation; idle has neither; goal has both and moves', async () => {
    const at = (state: 'live' | 'idle' | 'goal') => pixelSvg({ ...ARS, state, home: 'ARS', away: 'LEE', stamp: 1 })
    expect(at('live')).toContain('class="px-crowd"')
    expect(at('live')).toContain('class="px-ball"')
    expect(at('live')).not.toMatch(/animation|@keyframes/)
    expect(at('idle')).not.toContain('px-crowd')
    expect(at('idle')).not.toContain('px-ball')
    expect(at('idle')).not.toMatch(/animation|@keyframes/)
    expect(at('goal')).toContain('class="px-crowd"')
    expect(at('goal')).toContain('class="px-ball"')
    expect(at('goal')).toMatch(/@keyframes [a-z-]+\{/)
    // The idle board is dimmed; the live one is not.
    expect(/<g class="px-led"[^>]*opacity="\.38"/.test(at('idle'))).toBe(true)
    expect(/<g class="px-led"[^>]*opacity=/.test(at('live'))).toBe(false)
    expect(at('goal')).toContain('@media (prefers-reduced-motion:reduce){')
    // Reduce motion turns every animation off, whatever else the rule holds.
    expect(/@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none!important/.test(at('goal'))).toBe(true)
  })

  test('Reduce motion names every class the goal animates: none is left moving', async () => {
    const css = (/<style>([^<]*)<\/style>/.exec(pixelSvg({ ...ARS, state: 'goal', home: 'ARS', away: 'LEE', stamp: 1 })) ?? [])[1] as string
    const cut = css.indexOf('@media (prefers-reduced-motion:reduce){')
    expect(cut).toBeGreaterThan(0)
    const rules = css.slice(0, cut).replace(/@keyframes [a-z0-9-]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    const animated = new Set<string>()
    for (const rule of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/animation\s*:/.test(rule[2] as string)) continue
      for (const c of (rule[1] as string).matchAll(/\.([a-z][a-z0-9-]*)/g)) animated.add(c[1] as string)
    }
    expect(animated.size).toBeGreaterThan(3)
    const reduced = css.slice(cut)
    for (const c of animated) expect(new RegExp(`\\.${c}(?![a-z0-9-])`).test(reduced), c).toBe(true)
  })

  test('a goal\'s source carries its stamp, so two goals are two sources (an unchanged source is not drawn again)', async () => {
    const goal = (stamp: number) => pixelSvg({ ...ARS, state: 'goal', home: 'ARS', away: 'LEE', stamp })
    expect(goal(1)).not.toBe(goal(2))
    expect(stampOf(goal(41))).toBe(41)
    expect(goal(1).replace('<desc>goal 1</desc>', '<desc>goal 2</desc>')).toBe(goal(2))
    // A stamp that is no positive integer is 0; live and idle carry none.
    for (const s of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(stampOf(pixelSvg({ ...ARS, state: 'goal', stamp: s }))).toBe(0)
    expect(pixelSvg({ ...ARS, state: 'live', stamp: 9 })).toBe(pixelSvg({ ...ARS, state: 'live' }))
  })
})

// ── The hooks: which scene is set, when, and what is drawn for it ───────────────────────────────────────────────

describe('teamScene: which drawing the look carries', () => {
  for (const scene of ['band', 'nope', '']) {
    test(`teamScene ${JSON.stringify(scene)}: 0.8.0's look, the band`, { options: { teamTheme: 'on', teamScene: scene } }, async ($, on) => {
      const { sets } = engine(on)
      await world($, on, [view(LINE, ARSENAL)], DESKTOP)
      expect(sets).toEqual([JSON.parse(JSON.stringify(buildLook('Arsenal', TEAM_COLORS['espn:359']).look))])
    })
  }

  test('teamTheme off: a scene chosen sets nothing and draws nothing', { options: { teamScene: 'pixel' } }, async ($, on) => {
    const { sets, clears } = engine(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await clock.advance(300_000)
    await command()
    expect(sets).toEqual([])
    expect(clears).toEqual([])
  })

  test('a terminal session: nothing is set', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [view(LINE, ARSENAL)])
    await clock.advance(300_000)
    expect(sets).toEqual([])
  })

  test('pitch: the team\'s colors as 0.8.0 builds them, a scene of ours, and our hook draws the pitch with the team\'s name', PITCH, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.colors).toEqual(colorsOf('Arsenal', 'espn:359'))
    expect(sceneOf(sets[0])).toMatch(NAME)
    expect(sceneOf(sets[0]).startsWith('pitch-')).toBe(true)
    expect(sceneOf(sets[0]).length).toBeLessThanOrEqual(64)
    expect(typeof sets[0]?.backdrop.glass.blur).toBe('number')
    for (const surface of ['desktop', 'mobile'] as const) expect(await drawn($, sceneOf(sets[0]), surface)).toBe(pitchSvg({ ...ARS, name: 'Arsenal' }))
  })

  test('pitch, no team pinned: pitch green, no name on the scarf', PITCH, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [view(LINE, { pick: null })], DESKTOP)
    expect(sets[0]?.colors).toEqual(colorsOf(undefined))
    expect(await drawn($, sceneOf(sets[0]))).toBe(pitchSvg({ main: '1f7a3d' }))
  })

  test('pitch: the same team on later views is never set again; a new pin is a new set under a new name', PITCH, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL), view(LINE, ARSENAL), view(LINE, ARSENAL), view(LINE)], DESKTOP)
    await clock.advance(15_000)
    await command()
    expect(sets).toHaveLength(1)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(sceneOf(sets[1])).not.toBe(sceneOf(sets[0]))
    expect(await drawn($, sceneOf(sets[1]))).toBe(pitchSvg({ ...LIV, name: 'Liverpool' }))
  })

  test('pitch: a live match and a goal change nothing (the pitch has no states)', PITCH, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('our hook draws only the scene this plugin last set: another plugin\'s and an unknown name are left beneath', PITCH, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]), 'desktop', 'someone-else')).toBe(undefined)
    expect(await drawn($, 'pitch-zzz-999')).toBe(undefined)
    expect(await drawn($, 'lagoon')).toBe(undefined)
  })
})

/** A view of the moments' competition that is not current and lists nothing live: a refresh that failed. */
const STALE = momentView([], [], { current: false })

describe('the pixel corner: its state follows the pinned team\'s match', () => {
  test('nothing live, a next fixture: idle, the next fixture\'s codes', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [view(LINE, { ...ARSENAL, ...NEXT_ARS })], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.colors).toEqual(colorsOf('Arsenal', 'espn:359'))
    expect(sceneOf(sets[0]).startsWith('pixel-')).toBe(true)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...ARS, state: 'idle', home: 'ARS', away: 'LEE' }))
  })

  test('nothing live and no next fixture: idle, an empty board', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...ARS, state: 'idle' }))
  })

  test('a next fixture that is no fixture (no sides, a side with no code): the board shows what it can, never the value', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [view(LINE, { ...ARSENAL, next: 'soon' }), view(LINE, { ...ARSENAL, next: { home: { code: 'ARS' }, away: { name: 'Leeds' } } })], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...ARS, state: 'idle' }))
    await clock.advance(300_000)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...ARS, state: 'idle', home: 'ARS', away: '---' }))
  })

  test('the pinned team\'s match is live, by a current view: live, that match\'s codes', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [live([0, 0])], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('a live match that is not the pinned team\'s: idle', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [live([0, 0], { pinned: false, pinnedSide: undefined, picked: false })], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('a view that is not current never starts live: its live list is not believed', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [live([0, 0], {}, { current: false })], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('the same state on later views: never set again; the score changing for the other side: nothing', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 0]), live([1, 0])], DESKTOP)
    await clock.advance(15_000)
    await command()
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('live, then one view that is not current (a failed refresh): the stadium stays live', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), STALE, live([0, 0])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('live, then views that are not current for more than five minutes: idle', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), STALE], DESKTOP)
    for (let i = 0; i < 4; i += 1) await clock.advance(300_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('live, then a current view with nothing live (full time): idle at once, the next fixture\'s codes', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), view(LINE, { current: true, ...NEXT_ARS })], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'idle', home: 'ARS', away: 'LEE' }))
  })
})

describe('the pixel corner: a goal for the pinned side', () => {
  test('the pinned side scores: one goal set, drawn as the goal with a stamp; the next reading sets live again', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    const goal = (await drawn($, sceneOf(sets[1]))) as string
    expect(stampOf(goal)).toBeGreaterThan(0)
    expect(goal).toBe(pixelSvg({ ...LIV, state: 'goal', home: 'LAS', away: 'LIV', stamp: stampOf(goal) }))
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    expect(await drawn($, sceneOf(sets[2]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
  })

  test('readings inside the goal\'s six seconds (the command, a client attaching) do not end it', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command, attach } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await command()
    await clock.advance(GOAL_MS - 2_000)
    await command('theme')
    await attach('mobile', 'm1')
    await clock.advance(1)
    expect(sets).toHaveLength(2)
  })

  test('a reading after the six seconds ends it, whoever asks', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(GOAL_MS + 1)
    await command()
    expect(sets).toHaveLength(3)
    expect(await drawn($, sceneOf(sets[2]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('two goals: two goal sets, two stamps, and every set under its own name', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1]), live([0, 1]), live([0, 2]), live([0, 2])], DESKTOP)
    await clock.advance(15_000)
    const first = stampOf((await drawn($, sceneOf(sets[1]))) as string)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(4)
    const second = stampOf((await drawn($, sceneOf(sets[3]))) as string)
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(0)
    expect(second).not.toBe(first)
    await clock.advance(15_000)
    expect(sets).toHaveLength(5)
    const names = sets.map(sceneOf)
    expect(new Set(names).size).toBe(names.length)
  })

  test('two goals in one reading (0 to 2): one goal set', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 2])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(stampOf((await drawn($, sceneOf(sets[1]))) as string)).toBeGreaterThan(0)
  })

  const noGoal: Array<[string, Record<string, unknown>, Array<[number, number]>, Record<string, unknown>]> = [
    ['a goal against', {}, [[0, 0], [1, 0]], {}],
    ['a goal ruled out (the tally falls)', {}, [[0, 1], [0, 0]], {}],
    ['a match where neither side is the team the view picks', {}, [[0, 0], [0, 1]], { away: { code: 'XXX', name: 'Other', id: 'espn:1' } }],
    ['celebrate off', { celebrate: 'off' }, [[0, 0], [0, 1]], {}],
  ]
  for (const [label, options, scores, over] of noGoal) {
    test(`${label}: no goal set`, { options: { ...PIXEL.options, ...options } }, async ($, on) => {
      const { sets } = engine(on)
      const { clock } = await world($, on, scores.map((s) => live(s, over)), DESKTOP)
      await clock.advance(15_000)
      await clock.advance(15_000)
      expect(sets).toHaveLength(1)
    })
  }

  test('another match\'s goal under toasts all: no goal set', { options: { ...PIXEL.options, toasts: 'all' } }, async ($, on) => {
    const { sets } = engine(on)
    const other = (score: [number, number]) => liveRecord(score, { id: '702002', pinned: false, picked: false, pinnedSide: undefined })
    const { clock } = await world($, on, [momentView([liveRecord([0, 0]), other([0, 0])]), momentView([liveRecord([0, 0]), other([0, 1])])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('the tally rises for the pinned side while the other side\'s falls (a correction, not a goal): no goal set', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([1, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('the same match id under another competition is another match: no goal set', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const other = { competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' } }
    const { clock } = await world($, on, [live([0, 0]), live([0, 1], {}, other)], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('the first view of a session already holds a score: no goal (nothing to compare with)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [live([0, 3])], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('with no team pinned, a goal is nobody\'s: no goal set', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const over = { pinned: false, picked: false, pinnedSide: undefined }
    const { clock } = await world($, on, [live([0, 0], over, { pick: null }), live([0, 1], over, { pick: null })], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })
})

describe('the pixel corner: whose match it is, and what it remembers', () => {
  const ARSENAL_NEXT = { ...ARSENAL, ...NEXT_ARS }

  test('the team is the one the view picks (CLAUDINHO_TEAM over the saved pin): its record is the picked one, its side found by its id', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    // The saved pin is another team: the record is picked, not pinned, and names no pinned side.
    const over = { pinned: false, pinnedSide: undefined, picked: true }
    const { clock } = await world($, on, [live([0, 0], over), live([0, 1], over)], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(stampOf((await drawn($, sceneOf(sets[1]))) as string)).toBeGreaterThan(0)
  })

  test('the saved pin\'s match while the view picks another team: not this stadium\'s match (idle, no goal)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const over = { pinned: true, pinnedSide: 'away', picked: false }
    const { clock } = await world($, on, [live([0, 0], over, ARSENAL), live([0, 1], over, ARSENAL)], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...ARS, state: 'idle' }))
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('a pick with no id (a World Cup nation): its side is found by its code', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const wc = { competition: { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'saved' }, pick: { code: 'MEX', name: 'Mexico' } }
    const sides = { home: { code: 'MEX', name: 'Mexico' }, away: { code: 'BRA', name: 'Brazil' }, names: { home: 'Mexico', away: 'Brazil' }, pinnedSide: undefined }
    const { clock } = await world($, on, [live([0, 0], sides, wc), live([1, 0], sides, wc)], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(stampOf((await drawn($, sceneOf(sets[1]))) as string)).toBeGreaterThan(0)
  })

  test('live, then the pick changes in the same competition on a view that is not current: the new team\'s stadium is idle, never the old match in new colors', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), momentView([], [], { current: false, ...ARSENAL_NEXT })], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...ARS, state: 'idle', home: 'ARS', away: 'LEE' }))
  })

  test('live, then another competition with the same pick on a view that is not current: idle', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), view(LINE)], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('live, then the CLI fails for more than five minutes: the stadium empties (the hold ends without a readable view)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), new Error('spawn claudinho ENOENT')], DESKTOP)
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('live, then the CLI fails for under five minutes: the stadium stays as it is', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), new Error('spawn claudinho ENOENT')], DESKTOP)
    for (let i = 0; i < 8; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('a goal, then the CLI fails: the goal ends at the next reading (live while the hold lasts), then the stadium empties', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1]), new Error('spawn claudinho ENOENT')], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    expect(await drawn($, sceneOf(sets[2]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(4)
    expect(await drawn($, sceneOf(sets[3]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('a session whose CLI never answers sets nothing, as in 0.8.0', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [new Error('spawn claudinho ENOENT')], DESKTOP)
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toEqual([])
  })

  test('live, theme off, then the CLI fails past the hold: nothing is set (the look is off)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 0]), new Error('spawn claudinho ENOENT')], DESKTOP)
    await command('theme off')
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('live, then every set is refused while the CLI fails: the stadium\'s emptying is tried once, not per tick', PIXEL, async ($, on) => {
    const { sets } = engine(on, (n) => n > 1)
    const { clock } = await world($, on, [live([0, 0]), new Error('spawn claudinho ENOENT')], DESKTOP)
    for (let i = 0; i < 60; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
  })

  test('a new session forgets the match: a first view that is not current is idle, and a goal from before is not played again', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const stale = momentView([liveRecord([0, 1])], [], { current: false })
    const { clock } = await world($, on, [live([0, 0]), live([0, 1]), stale], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    await clock.advance(1)
    await clock.advance(15_000)
    const last = (await drawn($, sceneOf(sets[sets.length - 1]))) as string
    expect(sets.length).toBeGreaterThan(2)
    expect(last).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })
})

describe('the pixel corner: the edges the first cases did not reach', () => {
  const ERR = new Error('spawn claudinho ENOENT')
  const LASK_PICK = { pick: { id: 'espn:1886', code: 'LAS', name: 'LASK Linz' } }
  const idleNext = momentView([], [], { current: true, next: { id: '702001', home: { code: 'LAS' }, away: { code: 'LIV' }, status: 'SCHEDULED' } })

  test('kickoff: the idle board already shows the fixture that then goes live; the stadium fills (the state is part of what is set)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [idleNext, live([0, 0])], DESKTOP)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'idle', home: 'LAS', away: 'LIV' }))
    for (let i = 0; i < 20 && sets.length < 2; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('the hold is five minutes: still live at 4 min 45 s of failures, empty by 5 min 30 s', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), ERR], DESKTOP)
    for (let i = 0; i < 19; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
    for (let i = 0; i < 3; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
  })

  test('the picked team at home: its goal is a goal; its tally rising while the other side\'s falls is not', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([1, 1], {}, LASK_PICK), live([2, 1], {}, LASK_PICK), live([2, 1], {}, LASK_PICK), live([3, 0], {}, LASK_PICK)], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(stampOf((await drawn($, sceneOf(sets[1]))) as string)).toBeGreaterThan(0)
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
  })

  test('a side that carries the pick\'s code under another id is another team: its goal is not the pick\'s', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const sides = { home: { code: 'LIV', name: 'Liverpool Montevideo', id: 'espn:999' }, away: { code: 'XXX', name: 'Other', id: 'espn:1' } }
    const { clock } = await world($, on, [live([0, 0], sides), live([1, 0], sides)], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('a goal belongs to its match: another match of the pick, read inside the six seconds, is live, not a goal', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 1]), live([0, 1], { id: '702002' })], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await command()
    expect(sets).toHaveLength(3)
    expect(await drawn($, sceneOf(sets[2]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('an idle stadium and a CLI that then fails: nothing more is set (only a live stadium has a hold to end)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [idleNext, ERR], DESKTOP)
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('live, a new session, then the CLI fails past the hold: nothing is set (the new session set no stadium)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), ERR], DESKTOP)
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })

  test('a goal, a new session, then the same match inside the six seconds: live, the goal is not played again', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    await clock.advance(1)
    await command()
    expect(sets.length).toBeGreaterThan(2)
    for (const s of sets.slice(2)) expect(Number.isNaN(stampOf((await drawn($, sceneOf(s))) ?? ''))).toBe(true)
  })

  test('the desktop app detaches and the phone stays: with no surface for the band no CLI runs, and the stadium still empties after the hold', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, detach } = await world($, on, [live([0, 0])], { ...DESKTOP, surfaces: ['desktop', 'mobile'] })
    await detach('desktop')
    for (let i = 0; i < 19; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
    for (let i = 0; i < 4; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]), 'mobile')).toBe(pixelSvg({ ...LIV, state: 'idle' }))
    for (let i = 0; i < 40; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
  })
})

describe('the pixel corner: its memory has one owner and one way to be forgotten', () => {
  const STALE_ARS = momentView([], [], { current: false, ...ARSENAL, ...NEXT_ARS })
  const LASK_PICK = { pick: { id: 'espn:1886', code: 'LAS', name: 'LASK Linz' } }

  test('live, another team on a view that is not current, then the first team again inside five minutes: idle (the change forgot the match)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { command } = await world($, on, [live([0, 0]), STALE_ARS, STALE], DESKTOP)
    await command()
    expect(sets).toHaveLength(2)
    await command()
    expect(sets).toHaveLength(3)
    expect(await drawn($, sceneOf(sets[2]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('live, theme off, then theme on with a view that is not current: idle (the off forgot the match)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { command } = await world($, on, [live([0, 0]), STALE], DESKTOP)
    await command('theme off')
    await command('theme on')
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('a goal, theme off and on inside its six seconds: live, the goal is not played again', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await command('theme off')
    await command('theme on')
    expect(sets).toHaveLength(3)
    expect(await drawn($, sceneOf(sets[2]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('a goal, then the other side of the same match is picked inside the six seconds: its stadium is live, never the opponent\'s goal in its colors', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0]), live([0, 1]), live([0, 1], {}, LASK_PICK)], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    await command()
    expect(sets).toHaveLength(3)
    const source = (await drawn($, sceneOf(sets[2]))) as string
    expect(Number.isNaN(stampOf(source))).toBe(true)
    expect(source).toContain('class="px-crowd"')
  })

  test('live, then answers that are no view (an older CLI\'s object) past the hold: the stadium empties', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), JSON.stringify({ api: 1, line: 'x' })], DESKTOP)
    for (let i = 0; i < 60; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...LIV, state: 'idle' }))
  })

  test('a session with only the phone: the command never starts a live stadium nothing would end (idle, the next fixture\'s codes)', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock, command } = await world($, on, [live([0, 0], {}, NEXT_ARS)], { start: { surface: 'mobile', isInteractive: true } })
    await command()
    expect(sets).toHaveLength(1)
    expect(await drawn($, sceneOf(sets[0]), 'mobile')).toBe(pixelSvg({ ...LIV, state: 'idle', home: 'ARS', away: 'LEE' }))
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(1)
  })
})

describe('sets the engine refuses, names, the off and a reload', () => {
  test('a refused set is not tried again per tick: every set refused, a goal and twenty ticks make at most three attempts', PIXEL, async ($, on) => {
    const { sets } = engine(on, () => true)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    for (let i = 0; i < 20; i += 1) await clock.advance(15_000)
    expect(sets.length).toBeGreaterThanOrEqual(2)
    expect(sets.length).toBeLessThanOrEqual(3)
  })

  test('a drawn set, then a refused one: the app still shows the first, and our hook still draws it', PIXEL, async ($, on) => {
    const { sets } = engine(on, (n) => n === 2)
    const { clock } = await world($, on, [live([0, 0]), view(LINE, { current: true, ...NEXT_ARS })], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
    expect(await drawn($, sceneOf(sets[1]))).toBe(undefined)
  })

  test('theme off where the engine refuses the clear: our look still stands, and our hook still draws it', PIXEL, async ($, on) => {
    const sets: SetArgs[] = []
    on('theme.set', (_$, e) => {
      sets.push(JSON.parse(JSON.stringify(e)) as SetArgs)
      return { value: { isDrawn: true, requestId: 'theme' } }
    })
    on('theme.clear', () => ({ deny: 'theme.clear denied' }))
    const { command } = await world($, on, [live([0, 0])], DESKTOP)
    await command('theme off')
    expect(await drawn($, sceneOf(sets[0]))).toBe(pixelSvg({ ...LIV, state: 'live', home: 'LAS', away: 'LIV' }))
  })

  test('every set has a name no earlier set had, across a reload too', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    await clock.advance(1)
    await clock.advance(15_000)
    const names = sets.map(sceneOf)
    expect(names.length).toBeGreaterThanOrEqual(4)
    for (const n of names) expect(n).toMatch(NAME)
    expect(new Set(names).size).toBe(names.length)
  })

  test('theme off: the look is cleared and our hook draws nothing for the old name; theme on sets the scene again under a new name', PIXEL, async ($, on) => {
    const { sets, clears } = engine(on)
    const { command } = await world($, on, [view(LINE, { ...ARSENAL, ...NEXT_ARS })], DESKTOP)
    const first = sceneOf(sets[0])
    await command('theme off')
    expect(clears).toHaveLength(1)
    expect(await drawn($, first)).toBe(undefined)
    await command('theme on')
    expect(sets).toHaveLength(2)
    expect(sceneOf(sets[1])).not.toBe(first)
    expect(await drawn($, sceneOf(sets[1]))).toBe(pixelSvg({ ...ARS, state: 'idle', home: 'ARS', away: 'LEE' }))
  })

  test('the theme command says what it said in 0.8.0, whatever the scene', PIXEL, async ($, on) => {
    engine(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme')).text.startsWith('Team look: Arsenal.')).toBe(true)
  })
})
