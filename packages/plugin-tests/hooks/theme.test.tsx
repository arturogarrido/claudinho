import { describe, expect, test } from 'claude-code/testing'
import { NATION_IDS, TEAM_COLORS } from './team-colors'
import { buildLook, colorsForPick } from './team-look'
import { FIRST_RUN, view, world } from './world'

/**
 * The team look (plugin 0.8.0): with `teamTheme: on`, in a session a desktop or mobile app is attached to, the plugin
 * sets ONE theme from the pinned team (the view's `pick`): colors for both modes and a still wash at the edges. Off is
 * the default, and then the plugin never names the session's theme: a session holds one theme, and a set replaces the
 * one the person had. The look is set when its team changes, never once per tick. `/claudinho theme` says what is set;
 * `/claudinho theme off` clears it for the session and `/claudinho theme on` sets it again.
 *
 * What an app paints is not asserted here (a mod's tests do not paint): these cases pin the calls and their arguments.
 */
const LINE = 'ARS vs LEE in 2d4h'
const ON = { options: { teamTheme: 'on' } }
const DESKTOP = { start: { surface: 'desktop', isInteractive: true } } as const
const ARSENAL = { pick: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }
const LIVERPOOL = { pick: { id: 'espn:364', code: 'LIV', name: 'Liverpool' } }
const NO_PIN = { pick: null }
const WORLD_CUP = { competition: { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'saved' } }

const SAID_OFF = 'The team look is off. Turn it on in /config (Team look).'
const SAID_NOT_DRAWN = 'The team look shows in the Claude desktop and mobile apps; nothing draws it in this session.'
const SAID_CLEARED = 'Team look cleared for this session. /claudinho theme on sets it again.'
const saidTeam = (name: string) => `Team look: ${name}.`
const SAID_PITCH_NO_PIN = 'Team look: pitch green (no team pinned).'
const saidPitchFor = (name: string) => `Team look: pitch green (no colors known for ${name}).`

type On = Parameters<Parameters<typeof test>[1]>[1]
/** The engine beneath the plugin: every theme the plugin sets and every clear, as the engine receives them. */
const themes = (on: On, answer: 'drawn' | 'not-drawn' | 'deny' = 'drawn') => {
  const sets: unknown[] = []
  const clears: number[] = []
  on('theme.set', (_$, e) => {
    sets.push(JSON.parse(JSON.stringify(e)))
    if (answer === 'deny') return { deny: 'theme.set denied' }
    return { value: answer === 'drawn' ? { isDrawn: true, requestId: 'theme' } : { isDrawn: false, reason: 'no client draws themes' } }
  })
  on('theme.clear', () => {
    clears.push(1)
    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  return { sets, clears }
}
const lookOf = (name: string | undefined, id?: string) => JSON.parse(JSON.stringify(buildLook(name, id === undefined ? undefined : TEAM_COLORS[id]).look))

describe('off, the default', () => {
  test('no option set: the plugin never names the theme, on a desktop session with a pinned team', async ($, on) => {
    const { sets, clears } = themes(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await clock.advance(300_000)
    await command()
    expect(sets).toEqual([])
    expect(clears).toEqual([])
  })

  test('teamTheme off: the same', { options: { teamTheme: 'off' } }, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await clock.advance(300_000)
    expect(sets).toEqual([])
  })

  test('a value that is neither on nor off is off', { options: { teamTheme: 'yes' } }, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(sets).toEqual([])
  })
})

describe('on: the look is the pinned team\'s', () => {
  test('one set after the first view: the pinned club\'s colors and the edge wash, as buildLook makes them', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(sets[0]).toEqual(lookOf('Arsenal', 'espn:359'))
  })

  test('the same team on later views: never set again', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await clock.advance(300_000)
    await clock.advance(300_000)
    await command()
    expect(sets).toHaveLength(1)
  })

  test('the pin changes: set once more, to the new team\'s look', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, ARSENAL), view(LINE, LIVERPOOL)], DESKTOP)
    await clock.advance(300_000)
    await clock.advance(300_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]).toEqual(lookOf('Liverpool', 'espn:364'))
    expect(sets[1]).not.toEqual(sets[0])
  })

  test('no team pinned: pitch green', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [view(LINE, NO_PIN)], DESKTOP)
    expect(sets).toEqual([lookOf(undefined)])
  })

  test('a pinned team the table does not hold: pitch green, and a later view of a known team sets its look', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, { pick: { id: 'espn:99999999', code: 'XYZ', name: 'Nowhere FC' } }), view(LINE, ARSENAL)], DESKTOP)
    expect(sets).toEqual([lookOf(undefined)])
    await clock.advance(300_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]).toEqual(lookOf('Arsenal', 'espn:359'))
  })

  test('a World Cup pin carries no id: the nation by its code', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [view(LINE, { ...WORLD_CUP, pick: { code: 'MEX', name: 'Mexico' } })], DESKTOP)
    expect(sets).toEqual([lookOf('Mexico', NATION_IDS.MEX)])
  })

  test('CLAUDINHO_TEAM gives a code alone: a nation under the World Cup, by its code as its name', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [view(LINE, { ...WORLD_CUP, pick: { code: 'MEX' } })], DESKTOP)
    expect(sets).toEqual([lookOf('MEX', NATION_IDS.MEX)])
  })

  test('a code alone under a club competition identifies nobody (MEX is not Mexico there): pitch green', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [view(LINE, { pick: { code: 'MEX' } })], DESKTOP)
    expect(sets).toEqual([lookOf(undefined)])
  })
})

describe('on: where and when nothing is set', () => {
  test('a terminal session: nothing draws a theme, nothing is set', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, ARSENAL)])
    await clock.advance(300_000)
    expect(sets).toEqual([])
  })

  test('a desktop app attaches to a terminal session: the look is set on the view its run reads', ON, async ($, on) => {
    const { sets } = themes(on)
    const { attach } = await world($, on, [view(LINE, ARSENAL)])
    expect(sets).toEqual([])
    await attach('desktop', 'd1')
    expect(sets).toEqual([lookOf('Arsenal', 'espn:359')])
  })

  test('a mobile app beside the desktop one: still one set (the theme is the session\'s)', ON, async ($, on) => {
    const { sets } = themes(on)
    const { attach } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await attach('mobile', 'm1')
    expect(sets).toHaveLength(1)
  })

  test('no competition followed (the first-run object): nothing is set', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [FIRST_RUN], DESKTOP)
    expect(sets).toEqual([])
  })

  test('the CLI gives no answer: nothing is set', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, [new Error('spawn claudinho ENOENT')], DESKTOP)
    expect(sets).toEqual([])
  })

  test('an answer that is no view (an older CLI, a truncated line): nothing is set', ON, async ($, on) => {
    const { sets } = themes(on)
    await world($, on, ['{"line":"x"'], DESKTOP)
    expect(sets).toEqual([])
  })

  test('the engine refuses the set: the band still draws its line, and the same team is not tried again each tick', ON, async ($, on) => {
    const { sets } = themes(on, 'deny')
    const { clock, mount } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await clock.advance(300_000)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
    expect(await (await mount({}, 'desktop')).findAll({ type: 'Text', text: LINE })).toHaveLength(1)
  })

  test('the engine answers not drawn: set once, not again each tick', ON, async ($, on) => {
    const { sets } = themes(on, 'not-drawn')
    const { clock } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
  })
})

describe('/claudinho theme', () => {
  test('the option off: it says so and how to turn it on, and names no theme', async ($, on) => {
    const { sets, clears } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme')).text).toBe(SAID_OFF)
    expect((await command('theme on')).text).toBe(SAID_OFF)
    expect((await command('theme off')).text).toBe(SAID_OFF)
    expect(sets).toEqual([])
    expect(clears).toEqual([])
  })

  test('on, a pinned team with colors: it names the team', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme')).text).toBe(saidTeam('Arsenal'))
    expect((await command(' theme ')).text).toBe(saidTeam('Arsenal'))
    expect(sets).toHaveLength(1)
  })

  test('on, no pin: pitch green and why', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, NO_PIN)], DESKTOP)
    expect((await command('theme')).text).toBe(SAID_PITCH_NO_PIN)
  })

  test('on, a team with no colors known: pitch green and the team\'s name', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, { pick: { id: 'espn:99999999', code: 'XYZ', name: 'Nowhere FC' } })], DESKTOP)
    expect((await command('theme')).text).toBe(saidPitchFor('Nowhere FC'))
  })

  test('on, in a terminal session: it says where the look shows', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)])
    expect((await command('theme')).text).toBe(SAID_NOT_DRAWN)
    expect(sets).toEqual([])
  })

  test('on, the engine answers not drawn: the same sentence', ON, async ($, on) => {
    themes(on, 'not-drawn')
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme')).text).toBe(SAID_NOT_DRAWN)
  })

  test('theme off: one clear, and no view sets a look again this session, a new pin included', ON, async ($, on) => {
    const { sets, clears } = themes(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL), view(LINE, ARSENAL), view(LINE, LIVERPOOL)], DESKTOP)
    expect((await command('theme off')).text).toBe(SAID_CLEARED)
    expect(clears).toHaveLength(1)
    await clock.advance(300_000)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
    expect((await command('theme')).text).toBe(SAID_CLEARED)
  })

  test('theme off twice: one clear', ON, async ($, on) => {
    const { clears } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await command('theme off')
    await command('theme off')
    expect(clears).toHaveLength(1)
  })

  test('theme on after off: the look is set again, to the team the command\'s own view states', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL), view(LINE, ARSENAL), view(LINE, LIVERPOOL)], DESKTOP)
    await command('theme off')
    expect((await command('theme on')).text).toBe(saidTeam('Liverpool'))
    expect(sets).toHaveLength(2)
    expect(sets[1]).toEqual(lookOf('Liverpool', 'espn:364'))
  })

  test('theme on while a look stands: nothing is set again', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme on')).text).toBe(saidTeam('Arsenal'))
    expect(sets).toHaveLength(1)
  })

  test('any other text after the command is the plain reply, as before', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    const plain = (await command()).text
    expect((await command('themes')).text).toBe(plain)
    expect((await command('theme  off')).text).toBe(plain)
  })
})

describe('the table and the look, as data', () => {
  const HEX = /^[0-9a-f]{6}$/
  /** The colors a look paints with, apart from its label. */
  const inputsOf = (look: { colors?: unknown }) => (look.colors as { inputs?: unknown }).inputs

  test('every color is six lowercase hex digits; an entry has one or two', async () => {
    const entries = Object.entries(TEAM_COLORS)
    expect(entries.length).toBeGreaterThan(100)
    for (const [id, colors] of entries) {
      expect(id, id).toMatch(/^espn:[1-9][0-9]{0,8}$/)
      expect(colors.length === 1 || colors.length === 2, id).toBe(true)
      for (const c of colors) expect(c, id).toMatch(HEX)
    }
  })

  test('the 48 World Cup nations, each by its code, each with colors', async () => {
    const codes = Object.keys(NATION_IDS)
    expect(codes).toHaveLength(48)
    for (const code of codes) {
      expect(code, code).toMatch(/^[A-Z]{3}$/)
      expect(Object.hasOwn(TEAM_COLORS, NATION_IDS[code] as string), code).toBe(true)
    }
  })

  test('the desktop app paints every look: no entry, and not pitch green, is refused for contrast', async () => {
    const refused: string[] = []
    for (const [id, colors] of [...Object.entries(TEAM_COLORS), ['pitch', undefined] as const]) {
      const { problems } = buildLook(id, colors)
      const line = problems.find((p) => p.startsWith("Desktop won't paint"))
      if (line !== undefined) refused.push(`${id}: ${line}`)
    }
    expect(refused).toEqual([])
  })

  test('a look is colors and a still gradient whose stops are palette names (it follows light and dark): no scene, no image, no raw color', async () => {
    const { look } = buildLook('Arsenal', TEAM_COLORS['espn:359'])
    expect(Object.keys(look).sort()).toEqual(['backdrop', 'colors'])
    const backdrop = look.backdrop as { gradient?: { stops?: unknown[] } }
    expect(Object.keys(backdrop)).toEqual(['gradient'])
    const stops = (backdrop.gradient?.stops ?? []).map((s) => (typeof s === 'string' ? s : (s as { color: string }).color))
    expect(stops.length).toBeGreaterThanOrEqual(2)
    expect(stops.filter((c) => !/^(surface-[0-3]|bg-accent|bg-pro)$/.test(c))).toEqual([])
    expect(stops).toContain('bg-accent')
    expect(stops).toContain('surface-0')
  })

  /** The wash's two edges: the first and the last stop's palette name. */
  const edges = (id: string) => {
    const backdrop = buildLook('X', TEAM_COLORS[id]).look.backdrop as { gradient: { stops: Array<{ color: string }> } }
    return [backdrop.gradient.stops[0]?.color, backdrop.gradient.stops.at(-1)?.color]
  }

  test('two colors: the main one washes the left edge and the second the right (Pumas blue and gold, Brazil green and yellow, Argentina blue and white, Barcelona blue and red)', async () => {
    expect(TEAM_COLORS['espn:233']).toEqual(['002b5c', 'd4a017'])
    expect(TEAM_COLORS['espn:205']).toEqual(['009c3b', 'fedf00'])
    expect(TEAM_COLORS['espn:202']).toEqual(['74acdf', 'ffffff'])
    expect(TEAM_COLORS['espn:83']).toEqual(['004d98', 'a50044'])
    for (const id of ['espn:233', 'espn:205', 'espn:202', 'espn:83']) expect(edges(id), id).toEqual(['bg-accent', 'bg-pro'])
  })

  test('one color: both edges in it; a near-gray main color takes the second as its one color (Newcastle)', async () => {
    expect(TEAM_COLORS['espn:364']).toHaveLength(1)
    expect(edges('espn:364')).toEqual(['bg-accent', 'bg-accent'])
    expect(TEAM_COLORS['espn:361']).toEqual(['2d2d2d', '41b6e6'])
    expect(edges('espn:361')).toEqual(['bg-accent', 'bg-accent'])
  })

  test('two teams of different colors get different colors; the name does not change the colors', async () => {
    const a = buildLook('Arsenal', TEAM_COLORS['espn:359']).look
    const b = buildLook('Chelsea', TEAM_COLORS['espn:363']).look
    expect(JSON.stringify(a.colors)).not.toBe(JSON.stringify(b.colors))
    const renamed = buildLook('Someone', TEAM_COLORS['espn:359']).look
    expect(inputsOf(renamed)).toEqual(inputsOf(a))
    expect(inputsOf(a)).not.toEqual(inputsOf(b))
  })

  test('a color that is not six hex digits is no color: pitch green instead, never a throw', async () => {
    const pitch = inputsOf(buildLook(undefined, undefined).look)
    expect(pitch).not.toEqual(inputsOf(buildLook('Arsenal', TEAM_COLORS['espn:359']).look))
    for (const bad of [['zzzzzz'], ['#e20520'], ['e2052'], [''], ['e20520', 'nope']] as const) {
      const made = buildLook('X', bad as unknown as readonly [string, string?])
      expect(inputsOf(made.look), String(bad)).toEqual(pitch)
      expect(made.problems.filter((p) => p.startsWith("Desktop won't paint"))).toEqual([])
    }
  })

  test('colorsForPick: the id decides; a nation by its code only under the World Cup and only with no id', async () => {
    expect(colorsForPick({ id: 'espn:359', code: 'ARS', name: 'Arsenal' }, 'eng.1')).toEqual(TEAM_COLORS['espn:359'])
    expect(colorsForPick({ id: 'espn:359', code: 'MEX', name: 'x' }, 'fifa.world')).toEqual(TEAM_COLORS['espn:359'])
    expect(colorsForPick({ code: 'MEX', name: 'Mexico' }, 'fifa.world')).toEqual(TEAM_COLORS[NATION_IDS.MEX as string])
    expect(colorsForPick({ code: 'MEX' }, 'eng.1')).toBeUndefined()
    expect(colorsForPick({ code: 'mex' }, 'fifa.world')).toBeUndefined()
    expect(colorsForPick({ id: 'espn:99999999', code: 'MEX' }, 'fifa.world')).toBeUndefined()
  })

  test('colorsForPick: a value that is no pick, or a key every object has, is no team', async () => {
    for (const pick of [null, undefined, 'espn:359', 359, [], {}, { id: 359 }, { id: '__proto__' }, { id: 'constructor' }, { id: 'toString' }, { code: 'constructor' }, { code: '__proto__' }, { code: 'hasOwnProperty' }]) {
      expect(colorsForPick(pick, 'fifa.world')).toBeUndefined()
    }
    expect(colorsForPick({ code: 'MEX' }, undefined)).toBeUndefined()
    expect(colorsForPick({ code: 'MEX' }, { slug: 'fifa.world' })).toBeUndefined()
  })
})
