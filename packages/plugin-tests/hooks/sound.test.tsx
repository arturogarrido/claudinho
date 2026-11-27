import { describe, expect, test, type TestBody } from 'claude-code/testing'
import { GOAL_SOUND, IDLE_SOUND, LIVE_SOUND, OTHER_GOAL_SOUND } from './sound.approved'
import { liveRecord, momentView, view, world } from './world'

/**
 * The pixel stadium's sound (plugin 0.13.0): under `teamTheme: on` and `teamScene: pixel`, each set of the stadium's
 * look carries the desktop app's theme sound for the stadium's state (wind while idle, the murmur while the pinned
 * team's match is live, the roar at its goal, a groan at the other side's), each with a whistle on a click of the
 * backdrop; the app plays it once the person presses the speaker in the session's title bar. The band and the pitch
 * carry none. A build whose `$.theme.set` refuses `sound` (before Claude Code 2.1.330) is sent the same look once more
 * without it, and no later set of the module's life asks for sound.
 *
 * The kit's engine runs its host check on a set's arguments before the stub below answers, so a set the stub records
 * was taken by that check: a sound out of range never reaches it. What the app plays, and whether it thinks a sound
 * too costly, is a person's listen in the app.
 */
const LINE = 'ARS vs LEE in 2d4h'
const DESKTOP = { start: { surface: 'desktop', isInteractive: true } } as const
const PIXEL = { options: { teamTheme: 'on', teamScene: 'pixel' } }
const ARSENAL = { pick: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }

type On = Parameters<TestBody>[1]
type SetArgs = { colors?: unknown; backdrop?: { scene: string }; sound?: unknown }

/** The engine beneath: every theme set that reaches it; `refuseSound` refuses each one that carries a sound. */
const engine = (on: On, refuseSound = false) => {
  const sets: SetArgs[] = []
  on('theme.set', (_$, e) => {
    const args = JSON.parse(JSON.stringify(e)) as SetArgs
    sets.push(args)
    if (refuseSound && args.sound !== undefined) return { deny: 'theme.set: sound is not taken by this build' }
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
  return { sets }
}
/** A current view with the moments' match live at `score` (LASK Linz v Liverpool, the pin Liverpool, away). */
const live = (score: [number, number]) => momentView([liveRecord(score)], [])
const withoutSound = (s: SetArgs | undefined): SetArgs => {
  const { sound: _sound, ...rest } = s as SetArgs
  return rest
}

describe('the pixel stadium sounds its state', () => {
  test('idle: the wind, and the whistle on a click', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [view(LINE, ARSENAL)], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.sound).toEqual(IDLE_SOUND)
  })

  test('the pinned team\'s match live: the murmur', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    await world($, on, [live([0, 0])], DESKTOP)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.sound).toEqual(LIVE_SOUND)
  })

  test('the pinned side scores: the roar with the goal\'s set, then the murmur with the next', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]?.sound).toEqual(GOAL_SOUND)
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    expect(sets[2]?.sound).toEqual(LIVE_SOUND)
  })

  test('the other side scores: the groan, then the murmur', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([1, 0])], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]?.sound).toEqual(OTHER_GOAL_SOUND)
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    expect(sets[2]?.sound).toEqual(LIVE_SOUND)
  })

  test('full time: idle again, the wind', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), view(LINE, { current: true })], DESKTOP)
    await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]?.sound).toEqual(IDLE_SOUND)
  })

  test('celebrate off: no goal moment, so no roar; the murmur stays', { options: { ...PIXEL.options, celebrate: 'off' } }, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.sound).toEqual(LIVE_SOUND)
  })
})

describe('the stadium empties with no readable view', () => {
  test('live, then the CLI fails past the hold: idle, the wind', PIXEL, async ($, on) => {
    const { sets } = engine(on)
    const { clock } = await world($, on, [live([0, 0]), new Error('spawn claudinho ENOENT')], DESKTOP)
    for (let i = 0; i < 44; i += 1) await clock.advance(15_000)
    expect(sets).toHaveLength(2)
    expect(sets[1]?.sound).toEqual(IDLE_SOUND)
  })
})

describe('only the pixel stadium sounds', () => {
  for (const scene of ['band', 'pitch'])
    test(`teamScene ${scene}: no set carries a sound`, { options: { teamTheme: 'on', teamScene: scene } }, async ($, on) => {
      const { sets } = engine(on)
      const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
      await clock.advance(15_000)
      expect(sets.length).toBeGreaterThan(0)
      for (const s of sets) expect(Object.hasOwn(s, 'sound')).toBe(false)
    })
})

describe('a build that does not take sound', () => {
  test('a look refused with its sound AND without it says nothing of sound: a later state still carries its sound', PIXEL, async ($, on) => {
    // Both sends of the first look refused (a scene the engine refuses, a deny), every later one taken.
    const sets: SetArgs[] = []
    on('theme.set', (_$, e) => {
      sets.push(JSON.parse(JSON.stringify(e)) as SetArgs)
      if (sets.length <= 2) return { deny: 'theme.set denied' }
      return { value: { isDrawn: true, requestId: 'theme' } }
    })
    on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    expect(sets).toHaveLength(2)
    expect(sets[1]).toEqual(withoutSound(sets[0]))
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    expect(sets[2]?.sound).toEqual(GOAL_SOUND)
  })

  test('a set begun while the refused one was out (theme off): the look is not sent again without its sound', PIXEL, async ($, on) => {
    // The person turns the look off while the first send is out; that send is then refused: no second send.
    const sets: SetArgs[] = []
    const replies: unknown[] = []
    on('theme.set', async (_$, e) => {
      sets.push(JSON.parse(JSON.stringify(e)) as SetArgs)
      if (sets.length === 1) {
        replies.push(await $.command.run({ command: 'claudinho', args: 'theme off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }))
        return { deny: 'theme.set: sound is not taken by this build' }
      }
      return { value: { isDrawn: true, requestId: 'theme' } }
    })
    on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
    await world($, on, [live([0, 0]), live([0, 0])], DESKTOP)
    expect(replies).toHaveLength(1)
    expect(sets).toHaveLength(1)
  })

  test('the look is sent once more without it, and every later set carries none', PIXEL, async ($, on) => {
    const { sets } = engine(on, true)
    const { clock } = await world($, on, [live([0, 0]), live([0, 1])], DESKTOP)
    // The first state: the set with its sound (refused), then the same look without it.
    expect(sets).toHaveLength(2)
    expect(sets[0]?.sound).toEqual(LIVE_SOUND)
    expect(sets[1]).toEqual(withoutSound(sets[0]))
    // The goal: one set, with no sound asked.
    await clock.advance(15_000)
    expect(sets).toHaveLength(3)
    expect(Object.hasOwn(sets[2] as SetArgs, 'sound')).toBe(false)
    expect(sets[2]?.backdrop?.scene).not.toBe(sets[1]?.backdrop?.scene)
    // The goal's end: one more set, still none.
    await clock.advance(15_000)
    expect(sets).toHaveLength(4)
    expect(Object.hasOwn(sets[3] as SetArgs, 'sound')).toBe(false)
  })

  test('the stadium the retry set is the one drawn', PIXEL, async ($, on) => {
    const { sets } = engine(on, true)
    await world($, on, [live([0, 0])], DESKTOP)
    const scene = sets[1]?.backdrop?.scene as string
    const svgs = await (
      await $.ui.mount({ plugin: 'claudinho', surface: 'desktop', component: 'Backdrop', props: { scene, plugin: 'claudinho', glass: { blur: 20, opacity: 0.5 } }, viewport: { columns: 100, rows: 30 } } as Parameters<typeof $.ui.mount>[0])
    ).findAll({ type: 'Svg' })
    expect(svgs).toHaveLength(1)
  })
})
