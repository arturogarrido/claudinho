import { describe, expect, test, type TestBody } from 'claude-code/testing'
import { NATION_IDS, TEAM_COLORS } from './team-colors'
import { bandColor, bandSvg, buildLook, colorsForPick } from './team-look'
import { FIRST_RUN, START, view, world } from './world'

/**
 * The team look (plugin 0.8.0): with `teamTheme: on`, in a session the desktop app is attached to, the plugin
 * sets ONE theme from the pinned team (the view's `pick`): colors for both modes and a band across the top in the
 * team's two colors. Off is
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
const SAID_NOT_DRAWN = 'The team look shows in the Claude desktop app; nothing draws it in this session.'
/** Any other word after `theme`: the phrases and where the scene is chosen, answered at once (no run, no view, so no footer). */
const SAID_PHRASES = 'The theme phrases are /claudinho theme, theme on and theme off. The scene is the Team look scene option in /config.'
const SAID_CLEARED = 'Team look off for this session. /claudinho theme on sets it again.'
const SAID_PITCH_CODE = (code: string) => `Team look: pitch green (CLAUDINHO_TEAM gives a code, ${code}, and a code alone does not say which team: unset it to use your pinned team (claudinho follow <competition> --team <name> pins one)).`
const SAID_PITCH_UNREADABLE = 'Team look: pitch green (the team in CLAUDINHO_TEAM could not be read).'
/** A reply made from a view carries the view's attribution and disclaimer, each a paragraph, as every `/claudinho` reply does. */
const withD = (s: string) => `${s}\n\nLive data: ESPN\n\nNot affiliated with FIFA, any confederation, league or club, or Anthropic.`
const ARMENIA = { pick: { id: 'espn:579', code: 'ARM', name: 'Armenia' } }
const MALTA = { pick: { id: 'espn:453', code: 'MLT', name: 'Malta' } }
const saidTeam = (name: string) => `Team look: ${name}.`
const SAID_PITCH_NO_PIN = 'Team look: pitch green (no team pinned: claudinho follow <competition> --team <name> pins one).'
const saidPitchFor = (name: string) => `Team look: pitch green (no colors known for ${name}).`

type On = Parameters<TestBody>[1]
/** The engine beneath the plugin: every theme the plugin sets and every clear, as the engine receives them. */
const themes = (on: On, answer: 'drawn' | 'not-drawn' | 'deny' | 'deny-clear' = 'drawn') => {
  const sets: unknown[] = []
  const clears: number[] = []
  on('theme.set', (_$, e) => {
    sets.push(JSON.parse(JSON.stringify(e)))
    if (answer === 'deny') return { deny: 'theme.set denied' }
    return { value: answer === 'not-drawn' ? { isDrawn: false, reason: 'no client draws themes' } : { isDrawn: true, requestId: 'theme' } }
  })
  on('theme.clear', () => {
    clears.push(1)
    if (answer === 'deny-clear') return { deny: 'theme.clear denied' }
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
  test('one set after the first view: the pinned club\'s colors and its band, as buildLook makes them', ON, async ($, on) => {
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
    expect((await command('theme')).text).toBe(withD(SAID_OFF))
    expect((await command('theme on')).text).toBe(withD(SAID_OFF))
    expect((await command('theme off')).text).toBe(withD(SAID_OFF))
    expect(sets).toEqual([])
    expect(clears).toEqual([])
  })

  test('on, a pinned team with colors: it names the team', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme')).text).toBe(withD(saidTeam('Arsenal')))
    expect((await command(' theme ')).text).toBe(withD(saidTeam('Arsenal')))
    expect(sets).toHaveLength(1)
  })

  test('on, no pin: pitch green and why', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, NO_PIN)], DESKTOP)
    expect((await command('theme')).text).toBe(withD(SAID_PITCH_NO_PIN))
  })

  test('on, a team with no colors known: pitch green and the team\'s name', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, { pick: { id: 'espn:99999999', code: 'XYZ', name: 'Nowhere FC' } })], DESKTOP)
    expect((await command('theme')).text).toBe(withD(saidPitchFor('Nowhere FC')))
  })

  test('on, in a terminal session: it says where the look shows', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)])
    expect((await command('theme')).text).toBe(withD(SAID_NOT_DRAWN))
    expect(sets).toEqual([])
  })

  test('on, the engine answers not drawn: the same sentence', ON, async ($, on) => {
    themes(on, 'not-drawn')
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme')).text).toBe(withD(SAID_NOT_DRAWN))
  })

  test('theme off: one clear, and no view sets a look again this session, a new pin included', ON, async ($, on) => {
    const { sets, clears } = themes(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL), view(LINE, ARSENAL), view(LINE, LIVERPOOL)], DESKTOP)
    expect((await command('theme off')).text).toBe(withD(SAID_CLEARED))
    expect(clears).toHaveLength(1)
    await clock.advance(300_000)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
    expect((await command('theme')).text).toBe(withD(SAID_CLEARED))
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
    expect((await command('theme on')).text).toBe(withD(saidTeam('Liverpool')))
    expect(sets).toHaveLength(2)
    expect(sets[1]).toEqual(lookOf('Liverpool', 'espn:364'))
  })

  test('theme on while a look stands: nothing is set again', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect((await command('theme on')).text).toBe(withD(saidTeam('Arsenal')))
    expect(sets).toHaveLength(1)
  })

  test('any other text after the command is the plain reply, as before', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    const plain = (await command()).text
    expect((await command('themes')).text).toBe(plain)
    expect((await command('themepitch')).text).toBe(plain)
  })

  test('any other word after theme (a scene\'s name, a misspelt phrase): the phrases and where the scene is chosen, at once, with nothing set or cleared', ON, async ($, on) => {
    const { sets, clears } = themes(on)
    const { command, argvs } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    const before = { sets: sets.length, runs: argvs.length }
    for (const typed of ['theme pitch', 'theme pixel', 'theme band', 'theme  off', 'theme on now', 'theme\tpitch']) {
      expect((await command(typed)).text, typed).toBe(SAID_PHRASES)
    }
    expect(sets).toHaveLength(before.sets)
    expect(clears).toEqual([])
    expect(argvs).toHaveLength(before.runs)
  })

  test('the same reply with the option off: it names the phrases, and the option is where it is turned on', async ($, on) => {
    const { sets } = themes(on)
    const { command, argvs } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    const runs = argvs.length
    expect((await command('theme pixel')).text).toBe(SAID_PHRASES)
    expect(sets).toEqual([])
    expect(argvs).toHaveLength(runs)
  })
})

describe('/claudinho theme: what the first round of review found', () => {
  test('theme off survives a reload (an option changed in /config starts the session again): no reading sets the look until theme on', ON, async ($, on) => {
    const { sets, clears } = themes(on)
    const { clock, command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await command('theme off')
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    await clock.advance(1)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
    expect((await command('theme')).text).toBe(withD(SAID_CLEARED))
    expect(clears).toHaveLength(1)
    expect((await command('theme on')).text).toBe(withD(saidTeam('Arsenal')))
    expect(sets).toHaveLength(2)
  })

  test('a reload with nothing turned off: the engine dropped the look with the old module, and the next reading sets it again', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    await clock.advance(1)
    await clock.advance(300_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]).toEqual(sets[0])
  })

  test('theme off in a session where this plugin set no look never clears the session\'s theme (it may be the person\'s own): a terminal session', ON, async ($, on) => {
    const { sets, clears } = themes(on)
    const { command, attach } = await world($, on, [view(LINE, ARSENAL)])
    expect((await command('theme off')).text).toBe(withD(SAID_CLEARED))
    expect(clears).toEqual([])
    await attach('desktop', 'd1')
    expect(sets).toEqual([])
  })

  test('the same where the set was refused: nothing of ours stands, nothing is cleared', ON, async ($, on) => {
    const { clears } = themes(on, 'deny')
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await command('theme off')
    expect(clears).toEqual([])
  })

  test('a set the command makes is refused: the reply says nothing draws it, and nothing throws', ON, async ($, on) => {
    const { sets } = themes(on, 'deny')
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await command('theme off')
    expect((await command('theme on')).text).toBe(withD(SAID_NOT_DRAWN))
    expect(sets).toHaveLength(2)
  })

  test('the engine refuses the clear: the reply is the same, and no later reading sets a look', ON, async ($, on) => {
    const { sets, clears } = themes(on, 'deny-clear')
    const { clock, command } = await world($, on, [view(LINE, ARSENAL), view(LINE, ARSENAL), view(LINE, LIVERPOOL)], DESKTOP)
    expect((await command('theme off')).text).toBe(withD(SAID_CLEARED))
    expect(clears).toHaveLength(1)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
  })

  test('only the mobile app attached: nothing sets the look (the phone drew neither colors nor a scene, Nov 22, 2026), and theme says where it shows', ON, async ($, on) => {
    const { sets } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], { start: { surface: 'mobile', isInteractive: true } })
    expect(sets).toEqual([])
    await command()
    expect(sets).toEqual([])
    expect((await command('theme')).text).toBe(withD(SAID_NOT_DRAWN))
    expect((await command('theme on')).text).toBe(withD(SAID_NOT_DRAWN))
    expect(sets).toEqual([])
  })

  test('the desktop app attaching to a phone-only session sets the look on its first reading', ON, async ($, on) => {
    const { sets } = themes(on)
    const { attach } = await world($, on, [view(LINE, ARSENAL)], { start: { surface: 'mobile', isInteractive: true } })
    expect(sets).toEqual([])
    await attach('desktop', 'd1')
    expect(sets).toEqual([lookOf('Arsenal', 'espn:359')])
  })

  test('the desktop app left: /claudinho theme says nothing draws it', ON, async ($, on) => {
    themes(on)
    const { command, detach } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await detach('desktop')
    expect((await command('theme')).text).toBe(withD(SAID_NOT_DRAWN))
  })

  test('two teams of the same color: the look is set again, under the new team\'s name', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, ARMENIA), view(LINE, MALTA)], DESKTOP)
    await clock.advance(300_000)
    expect(sets).toHaveLength(2)
    expect((sets[1] as { colors: { label: string } }).colors.label).toBe('Claudinho: Malta')
  })

  test('two teams with no colors known, one after the other: pitch green is set once', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, { pick: { id: 'espn:99999998', code: 'AAA', name: 'A' } }), view(LINE, { pick: { id: 'espn:99999999', code: 'BBB', name: 'B' } })], DESKTOP)
    await clock.advance(300_000)
    expect(sets).toHaveLength(1)
  })

  test('CLAUDINHO_TEAM names a club by its code: pitch green, and the reply says why and what to do', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, { pick: { code: 'ARS' } })], DESKTOP)
    expect((await command('theme')).text).toBe(withD(SAID_PITCH_CODE('ARS')))
  })

  test('the same sentence under a nations competition (it names no club), and a World Cup pin with a name and an unknown code is a team with no colors known', ON, async ($, on) => {
    themes(on)
    const nations = { competition: { slug: 'uefa.nations', alias: 'nations-league', name: 'UEFA Nations League', chosenBy: 'saved' } }
    const { command } = await world($, on, [view(LINE, { ...nations, pick: { code: 'NOR' } }), view(LINE, { ...nations, pick: { code: 'NOR' } }), view(LINE, { ...WORLD_CUP, pick: { code: 'XYZ', name: 'Nowhere' } })], DESKTOP)
    expect((await command('theme')).text).toBe(withD(SAID_PITCH_CODE('NOR')))
    expect((await command('theme')).text).toBe(withD(saidPitchFor('Nowhere')))
  })

  test('a set the engine answers not drawn still stands in the session (it draws when an app attaches): theme off clears it', ON, async ($, on) => {
    const { clears } = themes(on, 'not-drawn')
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    await command('theme off')
    expect(clears).toHaveLength(1)
  })

  test('after a reload the engine holds no look of ours until the next reading sets one: theme off typed first clears nothing', ON, async ($, on) => {
    const { sets, clears } = themes(on)
    const { command } = await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(sets).toHaveLength(1)
    await $.session.start({ cwd: START.cwd, surface: 'desktop', isInteractive: true })
    await command('theme off')
    expect(clears).toEqual([])
    expect(sets).toHaveLength(1)
  })

  test('CLAUDINHO_TEAM could not be read (pickUnreadable): the reply does not say no team is pinned', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [view(LINE, { pick: null, pickUnreadable: true })], DESKTOP)
    expect((await command('theme')).text).toBe(withD(SAID_PITCH_UNREADABLE))
  })

  test('a reply made from no view (the first-run object) carries no footer, as the plain reply carries none', ON, async ($, on) => {
    themes(on)
    const { command } = await world($, on, [FIRST_RUN], DESKTOP)
    const plain = (await command()).text
    expect((await command('theme')).text).toBe(plain)
  })
})

describe('the band behind the conversation', () => {
  const backdrop = ($: Parameters<TestBody>[0], scene: string, plugin = 'claudinho', surface: 'desktop' | 'mobile' = 'desktop') =>
    $.ui.mount({ plugin, surface, component: 'Backdrop', props: { scene, plugin, glass: { blur: 28, opacity: 0.5 } }, viewport: { columns: 100, rows: 30 } } as Parameters<typeof $.ui.mount>[0])

  test('our scene is drawn as one Svg, its source the band of the colors the scene names, with a description', ON, async ($, on) => {
    themes(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    for (const surface of ['desktop', 'mobile'] as const) {
      const svgs = await (await backdrop($, 'band-002b49-b59410', 'claudinho', surface)).findAll({ type: 'Svg' })
      expect(svgs).toHaveLength(1)
      expect(svgs[0]?.props.source).toBe(bandSvg('band-002b49-b59410'))
      expect(String(svgs[0]?.props.alt).trim()).not.toBe('')
    }
  })

  test('a new team is a new scene name, so the app draws the band again (the same name would keep the old drawing)', ON, async ($, on) => {
    const { sets } = themes(on)
    const { clock } = await world($, on, [view(LINE, ARSENAL), view(LINE, LIVERPOOL)], DESKTOP)
    await clock.advance(300_000)
    const scenes = sets.map((s) => (s as { backdrop: { scene: string } }).backdrop.scene)
    expect(scenes).toEqual(['band-ef0107-ffffff', 'band-c8102e-ffffff'])
  })

  test('another plugin\'s scene, and a scene of ours that names no band, are left to what is beneath', ON, async ($, on) => {
    themes(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(await (await backdrop($, 'band-002b49-b59410', 'someone-else')).findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await (await backdrop($, 'lagoon')).findAll({ type: 'Svg' })).toHaveLength(0)
  })

  test('the option off: our hook draws nothing, even for a band\'s name', async ($, on) => {
    themes(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(await (await backdrop($, 'band-002b49-b59410')).findAll({ type: 'Svg' })).toHaveLength(0)
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

  test('no entry holds a value the provider uses as a placeholder (its default pairs are black with c60000, and a color with 792dcd)', async () => {
    const held = Object.entries(TEAM_COLORS).filter(([, colors]) => colors.some((c) => c === 'c60000' || c === '792dcd'))
    expect(held).toEqual([])
  })

  test('the 48 World Cup nations, each by its code, each with colors', async () => {
    const codes = Object.keys(NATION_IDS)
    expect(codes).toHaveLength(48)
    for (const code of codes) {
      expect(code, code).toMatch(/^[A-Z]{3}$/)
      expect(Object.hasOwn(TEAM_COLORS, NATION_IDS[code] as string), code).toBe(true)
    }
  })

  // Every entry is asked, forty to a case: one case over the whole table ran close to the kit's limit per case on a
  // slow host (each look builds a full palette). The slices cover the table by construction; pitch green rides last.
  const LOOKS = [...Object.entries(TEAM_COLORS), ['pitch', undefined] as const]
  const LOOKS_PER_CASE = 40
  const asked: [number, number][] = []
  for (let from = 0; from < LOOKS.length; from += LOOKS_PER_CASE) {
    const to = Math.min(from + LOOKS_PER_CASE, LOOKS.length)
    asked.push([from, to])
    const what = to === LOOKS.length ? 'no entry, and not pitch green, is refused for contrast' : 'no entry is refused for contrast'
    test(`the desktop app paints every look, entries ${from + 1} to ${to} of ${LOOKS.length}: ${what}`, async () => {
      const refused: string[] = []
      for (const [id, colors] of LOOKS.slice(from, to)) {
        const { problems } = buildLook(id, colors)
        const line = problems.find((p) => p.startsWith("Desktop won't paint"))
        if (line !== undefined) refused.push(`${id}: ${line}`)
      }
      expect(refused).toEqual([])
    })
  }

  test('the cases above ask the whole table: their ranges run end to end from the first entry to the last, which is pitch green', async () => {
    expect(LOOKS).toHaveLength(Object.keys(TEAM_COLORS).length + 1)
    expect(LOOKS[LOOKS.length - 1]).toEqual(['pitch', undefined])
    expect(asked[0]?.[0]).toBe(0)
    expect(asked[asked.length - 1]?.[1]).toBe(LOOKS.length)
    for (let i = 1; i < asked.length; i++) expect(asked[i]?.[0], `case ${i + 1}`).toBe(asked[i - 1]?.[1])
  })

  test('a look is colors and a scene: a band named for the team\'s two colors, frosted glass over it; no image, no still ground', async () => {
    const { look } = buildLook('Pumas UNAM', TEAM_COLORS['espn:233'])
    expect(Object.keys(look).sort()).toEqual(['backdrop', 'colors'])
    expect(look.backdrop).toEqual({ scene: 'band-002b49-b59410', glass: { blur: 28, opacity: 0.5 } })
    // One color: it is both halves. No colors known: pitch green.
    expect((buildLook('Armenia', TEAM_COLORS['espn:579']).look.backdrop as { scene: string }).scene).toBe('band-de2400-de2400')
    expect((buildLook(undefined, undefined).look.backdrop as { scene: string }).scene).toBe('band-1f7a3d-1f7a3d')
    // A near-gray main color keeps its place on the left: the band shows the team's two colors as they are.
    expect((buildLook('Newcastle United', TEAM_COLORS['espn:361']).look.backdrop as { scene: string }).scene).toBe('band-241f20-ffffff')
  })

  test('the pairs the maintainer named: Pumas blue and gold, Brazil yellow and green, Argentina blue and white, Barcelona blue and red', async () => {
    expect(TEAM_COLORS['espn:233']).toEqual(['002b49', 'b59410'])
    expect(TEAM_COLORS['espn:205']).toEqual(['ffdf00', '009c3b'])
    expect(TEAM_COLORS['espn:202']).toEqual(['75aadb', 'ffffff'])
    expect(TEAM_COLORS['espn:83']).toEqual(['004d98', 'a50044'])
  })

  test('a band color is the team\'s own, except a dark one, lifted to read on a dark page at its own hue, and a gray, which has no hue to lift', async () => {
    expect(bandColor('c2a25a')).toBe('#c2a25a')
    expect(bandColor('fedf00')).toBe('#fedf00')
    expect(bandColor('a50044')).toBe('#a50044')
    expect(bandColor('ffffff')).toBe('#f2f4f7')
    expect(bandColor('2d2d2d')).toBe('#8a8f98')
    const navy = bandColor('002b5c')
    expect(navy).toMatch(/^#[0-9a-f]{6}$/)
    expect(navy).not.toBe('#002b5c')
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(navy.slice(i, i + 2), 16)) as [number, number, number]
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
    // Lifted to a lightness of 0.4: readable on a dark page, still a dark blue.
    expect(Math.max(r, g, b) + Math.min(r, g, b)).toBeGreaterThanOrEqual(200)
    expect(Math.max(r, g, b) + Math.min(r, g, b)).toBeLessThanOrEqual(208)
    // A color already at that lightness or above is not touched.
    expect(bandColor('3a64a3')).toBe('#3a64a3')
  })

  test('the band\'s drawing is made from the scene\'s name alone: left half the main color, right half the second, nothing that loads or runs', async () => {
    const svg = bandSvg('band-002b49-b59410') as string
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('preserveAspectRatio="none"')
    expect(svg.length).toBeLessThan(4000)
    expect(svg.indexOf(bandColor('002b49'))).toBeGreaterThan(-1)
    expect(svg.indexOf('#b59410')).toBeGreaterThan(svg.indexOf(bandColor('002b49')))
    expect(svg).not.toMatch(/<script|href|url\(\s*['"]?(?!#)|@import|<image|<foreignObject|javascript:/i)
    expect(bandSvg('band-de2400-de2400')).not.toBe(svg)
  })

  test('a scene name that is not a band\'s is no drawing: another shape, a color that is not six lowercase hex digits, a value that is no string', async () => {
    for (const scene of ['band', 'band-002b5c', 'band-002b49-b59410-ffffff', 'band-002B49-b59410', 'band-zzzzzz-b59410', 'top-002b49-b59410', ' band-002b49-b59410', 'band-002b49-b59410\n', '', null, undefined, 7, {}, ['band-002b49-b59410']]) {
      expect(bandSvg(scene), JSON.stringify(scene)).toBeUndefined()
    }
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
