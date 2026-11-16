import type { Register } from 'claude-code'

import { FLAG_COLORS, TEAM_COLORS } from './team-colors'
import { bandSvg, buildLook } from './team-look'
import { pitchSvg, pixelSvg } from './team-scenes'

/**
 * Development only. Shows the Claudinho plugin's OWN drawings in the Claude desktop app, on demand, with no match
 * needed, so a change to what the plugin draws is seen in the app before it merges. `scripts/plugin-demo.sh` puts the
 * plugin's `team-scenes.ts`, `team-look.ts` and `team-colors.ts` (and the color builder) beside this module, so what
 * this draws is what the plugin on that checkout draws. It sets a scene the way the plugin does (`$.theme.set`, the
 * same glass, one `Svg`); it runs none of the plugin's hooks, reads no score and runs no CLI.
 *
 *   /demo <team>     spain, mexico, pumas, arsenal, argentina, italy: that team's stadium, live
 *   /demo band       the band of the team's two colors across the top (the plugin's default scene)
 *   /demo pitch      the pitch scene
 *   /demo idle       the stadium, empty
 *   /demo live       the stadium with its fans
 *   /demo goal       the team's goal: six seconds, a toast as the ball lands, then live again
 *   /demo other      the other team's goal, the same way
 *   /demo off        clears the look
 *
 * What it does not show: the plugin's own path from a real goal (its readings, its memory, its toast's text).
 */

const PLUGIN = 'claudinho-demo'
const GLASS = { blur: 20, opacity: 0.5 } as const
const GOAL_MS = 6_000
const BALL_LANDS_MS = 1_900

type Team = { id: string; name: string; home: string; away: string; otherId: string }
const TEAMS: Record<string, Team> = {
  spain: { id: 'espn:164', name: 'Spain', home: 'ESP', away: 'ARG', otherId: 'espn:202' },
  argentina: { id: 'espn:202', name: 'Argentina', home: 'ESP', away: 'ARG', otherId: 'espn:164' },
  mexico: { id: 'espn:203', name: 'Mexico', home: 'MEX', away: 'ITA', otherId: 'espn:162' },
  italy: { id: 'espn:162', name: 'Italy', home: 'MEX', away: 'ITA', otherId: 'espn:203' },
  pumas: { id: 'espn:233', name: 'Pumas UNAM', home: 'PUM', away: 'MTY', otherId: 'espn:220' },
  arsenal: { id: 'espn:359', name: 'Arsenal', home: 'ARS', away: 'PUM', otherId: 'espn:233' },
}
type What = 'pitch' | 'idle' | 'live' | 'goal' | 'other'

let team: Team = TEAMS.spain as Team
let serial = 0
/** The command being answered: a goal that waits checks it is still the latest before it toasts or sets live again. */
let run = 0
const scenes: Array<{ name: string; source: string }> = []

const draw = (what: What): string => {
  const [main, second] = TEAM_COLORS[team.id] ?? ['1f7a3d']
  if (what === 'pitch') return pitchSvg({ main: main as string, second, name: team.name })
  const other = TEAM_COLORS[team.otherId]
  return pixelSvg({
    main: main as string,
    second,
    state: what === 'other' ? 'goal' : what,
    home: team.home,
    away: team.away,
    stamp: serial,
    scarf: FLAG_COLORS[team.id],
    ...(what === 'other' ? { by: 'other', otherMain: other?.[0], otherSecond: other?.[1] } : {}),
  })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'demo', description: `Claudinho's drawings, for a look in the app: ${Object.keys(TEAMS).join(', ')}, band, pitch, idle, live, goal, other, off` })
    return next(e)
  })

  on('command.run', { command: 'demo' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    run += 1
    const mine = run
    const show = async (what: What): Promise<string> => {
      serial += 1
      const name = `demo-${serial}`
      const kept = { name, source: draw(what) }
      scenes.push(kept)
      while (scenes.length > 3) scenes.shift()
      const { look } = buildLook(team.name, TEAM_COLORS[team.id])
      try {
        const set = await $.theme.set({ colors: look.colors, backdrop: { scene: name, glass: { ...GLASS } } })
        return set.isDrawn ? 'drawn' : `not drawn (${set.reason})`
      } catch (err) {
        // A set that threw asked for nothing: its drawing is not kept for a later render.
        const at = scenes.indexOf(kept)
        if (at >= 0) scenes.splice(at, 1)
        throw err
      }
    }

    if (word === 'off') {
      // Forgotten first, as the plugin does: a render while the clear is on its way draws nothing of ours.
      scenes.length = 0
      await $.theme.clear()
      return { text: 'Demo look cleared.' }
    }
    if (word === 'band') {
      // The plugin's default scene: the look as `buildLook` makes it, its band drawn from the scene's own name.
      const { look } = buildLook(team.name, TEAM_COLORS[team.id])
      const set = await $.theme.set(look)
      return { text: `${team.name}, band: ${set.isDrawn ? 'drawn' : `not drawn (${set.reason})`}` }
    }
    if (Object.hasOwn(TEAMS, word)) {
      team = TEAMS[word] as Team
      return { text: `${team.name}, live: ${await show('live')}` }
    }
    if (word === 'pitch' || word === 'idle' || word === 'live') return { text: `${team.name}, ${word}: ${await show(word)}` }
    if (word === 'goal' || word === 'other') {
      const answer = await show(word)
      await $.clock.sleep(BALL_LANDS_MS)
      // A later command (another goal, `off`) took over while this one waited: it says no more and sets nothing.
      if (mine !== run) return { text: `${team.name}, ${word}: ${answer}` }
      await $.ui.toast(word === 'goal' ? `Demo: a goal for ${team.name}` : `Demo: a goal against ${team.name}`)
      await $.clock.sleep(GOAL_MS - BALL_LANDS_MS + 200)
      if (mine !== run) return { text: `${team.name}, ${word}: ${answer}` }
      await show('live')
      return { text: `${team.name}, ${word}: ${answer}, then live` }
    }
    return { text: `Try: /demo ${Object.keys(TEAMS).join(' | ')} | band | pitch | idle | live | goal | other | off` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== PLUGIN) return next(e)
    const source = scenes.find((s) => s.name === e.props.scene)?.source ?? bandSvg(e.props.scene)
    if (source === undefined) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={source} alt="A demo of the Claudinho plugin's drawing" />
  })
}
