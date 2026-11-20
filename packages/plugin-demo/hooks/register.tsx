import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import { FRAME_MS, FULLTIME_MS, GOAL_FRAMES, celebrationBall, celebrationRow, goalRow, resultRow } from './celebration'
import { FLAG_COLORS, TEAM_COLORS } from './team-colors'
import { bandSvg, buildLook } from './team-look'
import { pitchSvg, pixelSvg } from './team-scenes'

/**
 * Development only. Shows the Claudinho plugin's OWN drawings in the Claude desktop app, on demand, with no match
 * needed, so a change to what the plugin draws is seen in the app before it merges. `scripts/plugin-demo.sh` puts the
 * plugin's `team-scenes.ts`, `team-look.ts`, `team-colors.ts` (and the color builder) and `celebration.tsx` beside this
 * module, so what this draws is what the plugin on that checkout draws. It sets a scene the way the plugin does
 * (`$.theme.set`, the same glass, one `Svg`), and plays the goal and full-time celebration in the band above the prompt
 * with the plugin's own `celebrationRow`, `celebrationBall`, `goalRow` and `resultRow`, for the plugin's own lengths
 * (`FRAME_MS`, `GOAL_FRAMES`, `FULLTIME_MS`); it runs none of the plugin's hooks, reads no score and runs no CLI.
 *
 *   /demo <team>     spain, mexico, pumas, arsenal, argentina, italy: that team's stadium, live
 *   /demo band       the band of the team's two colors across the top (the plugin's default scene)
 *   /demo pitch      the pitch scene
 *   /demo idle       the stadium, empty
 *   /demo live       the stadium with its fans
 *   /demo goal       the team's goal: six seconds, a toast as the ball lands, then live again
 *   /demo other      the other team's goal, the same way
 *   /demo mascot     the goal celebration in the band above the prompt: the Claude mascot (in the desktop app drawn
 *                    shapes, in a terminal text art) beside the ball, the goal word and the team, and a demo scorer; 3 s
 *   /demo fulltime   the full-time celebration there: the mascot beside `Full time · <team> win`; 5 s
 *   /demo left       the stadium at the bottom left (the plugin's teamScenePlace: left) for every later drawing
 *   /demo right      the stadium at the bottom right again (the default)
 *   /demo en         the goal's word on the board in English (GOAL!: GOOOAL); es (¡GOL!), pt (GOL!): GOOOL; fr (BUT !): BUUUT
 *   /demo off        clears the look, and ends a celebration that is playing
 *
 * A celebration does not touch the look, and a scene's goal waiting to finish goes on beside it; a later `mascot`,
 * `fulltime` or `off` replaces or ends it. Its frame is read from the clock at each draw (500 ms a frame), redrawn by a
 * timer that runs while it plays.
 *
 * What it does not show: the plugin's own path from a real goal (its readings, its memory, its toast's text), and when
 * the plugin plays a celebration (the hold while Claude works, the 60-second drop, full time queued behind a goal).
 */

const PLUGIN = 'claudinho-demo'
const GLASS = { blur: 20, opacity: 0.5 } as const
const GOAL_MS = 6_000
const BALL_LANDS_MS = 1_900
/** The goal word of each of the CLI's four languages (core's `moment.goal`), as the plugin hands it to the board. */
const WORDS: Record<string, string> = { en: 'GOAL!', es: '¡GOL!', pt: 'GOL!', fr: 'BUT !' }
type Place = 'right' | 'left'

/** A demo team: its id, its name, its match's two codes, the other side's id, and its own side (whose goal the band plays). */
type Team = { id: string; name: string; home: string; away: string; otherId: string; side: 'home' | 'away' }
const TEAMS: Record<string, Team> = {
  spain: { id: 'espn:164', name: 'Spain', home: 'ESP', away: 'ARG', otherId: 'espn:202', side: 'home' },
  argentina: { id: 'espn:202', name: 'Argentina', home: 'ESP', away: 'ARG', otherId: 'espn:164', side: 'away' },
  mexico: { id: 'espn:203', name: 'Mexico', home: 'MEX', away: 'ITA', otherId: 'espn:162', side: 'home' },
  italy: { id: 'espn:162', name: 'Italy', home: 'MEX', away: 'ITA', otherId: 'espn:203', side: 'away' },
  pumas: { id: 'espn:233', name: 'Pumas UNAM', home: 'PUM', away: 'MTY', otherId: 'espn:220', side: 'home' },
  arsenal: { id: 'espn:359', name: 'Arsenal', home: 'ARS', away: 'PUM', otherId: 'espn:233', side: 'home' },
}
type What = 'pitch' | 'idle' | 'live' | 'goal' | 'other'

/** A celebration's kind: the goal's (`mascot`) or full time's. */
type Kind = 'mascot' | 'fulltime'
/** A play's frames, as the plugin plays it: a goal's `GOAL_FRAMES`, full time's `FULLTIME_MS` in frames. */
const framesOf = (kind: Kind): number => (kind === 'mascot' ? GOAL_FRAMES : FULLTIME_MS / FRAME_MS)
/** The goal's bottom row: a demo scorer and minute, where the plugin writes the scorer the CLI named. */
const DEMO_DETAIL = "Demo scorer 35'"
/** The band's width when the draw states none. */
const DEFAULT_COLUMNS = 80
/**
 * The celebration playing in the band: its kind, the clock's milliseconds it started at, its frames, the team and the
 * goal word it was asked with, and its redraw timer. Replaced by the next `mascot` or `fulltime`, ended by `off`.
 */
type Play = { kind: Kind; from: number; frames: number; team: Team; word: string; timer: Timer | null }

let team: Team = TEAMS.spain as Team
let serial = 0
/** The command being answered: a goal that waits checks it is still the latest before it toasts or sets live again. */
let run = 0
let place: Place = 'right'
let lang = 'en'
const scenes: Array<{ name: string; source: string }> = []
let playing: Play | null = null

/** The celebration in the band ended: its timer stopped, and nothing of it drawn at the next draw. */
function endPlay(): void {
  playing?.timer?.cancel()
  playing = null
}

/**
 * A celebration started in the band: the one before it ended, a draw asked now, then one every frame while it plays.
 * A frame's check that finds the play over (or replaced) stops this play's timer, and asks the draw that empties the
 * band when the play was still the one drawn.
 */
async function startPlay($: EngineInterface, kind: Play['kind']): Promise<void> {
  const from = await $.clock.now()
  endPlay()
  const play: Play = { kind, from, frames: framesOf(kind), team, word: WORDS[lang] ?? 'GOAL!', timer: null }
  playing = play
  play.timer = $.clock.every(FRAME_MS, () => {
    $.ui.invalidate('ui.render')
    $.clock.now().then(
      (now) => {
        if (playing === play && now - play.from < play.frames * FRAME_MS) return
        play.timer?.cancel()
        if (playing === play) {
          playing = null
          $.ui.invalidate('ui.render')
        }
      },
      () => {
        // The clock could not be read: the timer runs on to its next frame.
      },
    )
  })
  $.ui.invalidate('ui.render')
}

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
    word: WORDS[lang],
    place,
  })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'demo',
      description: `Claudinho's drawings, for a look in the app: ${Object.keys(TEAMS).join(', ')}, band, pitch, idle, live, goal, other, mascot, fulltime, left, right, ${Object.keys(WORDS).join(', ')}, off`,
    })
    return next(e)
  })

  on('command.run', { command: 'demo' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    // Only a command that sets or clears a drawing takes over from a goal that is waiting: a typo, or `/demo` alone,
    // answers with the list and leaves the goal to finish; so does a language, which draws nothing.
    const sets = word === 'off' || word === 'band' || word === 'pitch' || word === 'idle' || word === 'live' || word === 'goal' || word === 'other' || word === 'left' || word === 'right' || Object.hasOwn(TEAMS, word)
    if (sets) run += 1
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
      // Forgotten first, as the plugin does: a render while the clear is on its way draws nothing of ours. A
      // celebration playing in the band ends with it.
      scenes.length = 0
      if (playing !== null) {
        endPlay()
        $.ui.invalidate('ui.render')
      }
      await $.theme.clear()
      return { text: 'Demo look cleared.' }
    }
    if (word === 'mascot' || word === 'fulltime') {
      // The band's celebration: it touches no look, so a scene's goal waiting to finish goes on. It answers at once;
      // the play runs on by itself.
      await startPlay($, word)
      const what = word === 'mascot' ? 'goal celebration' : 'full time'
      return { text: `${team.name}, ${what}: playing in the band (${(framesOf(word) * FRAME_MS) / 1000} s)` }
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
    if (word === 'left' || word === 'right') {
      place = word
      return { text: `The stadium at the bottom ${place} from the next drawing; the live stadium now: ${await show('live')}` }
    }
    if (Object.hasOwn(WORDS, word)) {
      lang = word
      return { text: `The goal's word: ${WORDS[lang]} (/demo goal or /demo other to see it on the board, /demo mascot in the band)` }
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
    return { text: `Try: /demo ${Object.keys(TEAMS).join(' | ')} | band | pitch | idle | live | goal | other | mascot | fulltime | left | right | ${Object.keys(WORDS).join(' | ')} | off` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band above the prompt, where the plugin plays its celebration: the three rows, the line under them, then
    // the band beneath. A survey holds the band, and with fewer than three spare rows it draws nothing of ours.
    const play = playing
    if (play === null || e.props.hasSurvey || e.props.maxRows - 2 < 3) return next(e)
    // The frame from the clock at this draw, never from a count of draws.
    const elapsed = (await $.clock.now()) - play.from
    if (!(elapsed >= 0 && elapsed < play.frames * FRAME_MS)) return next(e)
    const step = Math.floor(elapsed / FRAME_MS)
    const width = e.props.bodyColumns
    const columns = typeof width === 'number' && Number.isInteger(width) && width > 0 ? width : DEFAULT_COLUMNS
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const shown = play.team
    // The score as the band would show it: the goal is the demo team's.
    const score = shown.side === 'home' ? '1–0' : '0–1'
    let middle: RenderChildren
    let top: string
    let bottom: string
    let line: string
    if (play.kind === 'mascot') {
      top = celebrationBall(step, columns)
      middle = goalRow(elements, play.word, shown.name)
      bottom = DEMO_DETAIL
      line = `⚽ ${shown.home} ${score} ${shown.away} 36'  · demo`
    } else {
      top = ' '
      middle = resultRow(elements, `Full time · ${shown.name} win`)
      bottom = ' '
      line = `⚽ ${shown.home} ${score} ${shown.away} FT  · demo`
    }
    return (
      <Box flexDirection="column">
        {celebrationRow(elements, e.surface, step, { top, middle, bottom })}
        <Text wrap="truncate-end">{line}</Text>
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== PLUGIN) return next(e)
    const source = scenes.find((s) => s.name === e.props.scene)?.source ?? bandSvg(e.props.scene)
    if (source === undefined) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={source} alt="A demo of the Claudinho plugin's drawing" />
  })
}
