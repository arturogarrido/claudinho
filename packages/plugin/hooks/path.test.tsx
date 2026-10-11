import { describe, expect, test } from 'claude-code/testing'
import { BARE_PATH, HOME, NVM, view, world } from './world'

/**
 * The PATH the CLI is run under. An app that starts Claude Code may hand it a bare PATH (`/usr/bin:/bin`), where an
 * npm or Homebrew `claudinho` is not found (measured: `ENOENT: Executable not found in $PATH`), and where the CLI by
 * its absolute path fails too (its `#!/usr/bin/env node` finds no node: exit 127). So every run is handed `env.PATH`:
 * the host's own PATH first (its claudinho wins), then the folders npm, Homebrew, nvm, Volta, pnpm and Bun install
 * global commands into; each folder once, the first place kept. On Windows nothing is handed (as before).
 */
const LINE = "⚽ ARS 2–1 CHE 50'"
const dir = (name: string) => ({ name, kind: 'dir' as const })
const AFTER_NVM = [
  `${HOME}/.volta/bin`,
  `${HOME}/.local/share/pnpm`,
  `${HOME}/Library/pnpm`,
  `${HOME}/.bun/bin`,
  `${HOME}/.npm-global/bin`,
  `${HOME}/.local/bin`,
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

describe('the PATH handed to the run', () => {
  test('the host PATH first, then nvm (newest first), then the other global-bin folders, each once', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { nvm: [dir('v22.17.0'), dir('v24.11.1')] })
    expect(envs[0]).toEqual({
      PATH: [BARE_PATH, `${NVM}/v24.11.1/bin`, `${NVM}/v22.17.0/bin`, ...AFTER_NVM].join(':'),
    })
  })

  test('nvm versions are ordered by number, not by text: v24 before v9', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { nvm: [dir('v9.0.0'), dir('v24.11.1'), dir('v22.17.0')] })
    const parts = (envs[0]?.PATH ?? '').split(':')
    const first = BARE_PATH.split(':').length // the host's own folders come first
    expect([parts.indexOf(`${NVM}/v24.11.1/bin`), parts.indexOf(`${NVM}/v22.17.0/bin`), parts.indexOf(`${NVM}/v9.0.0/bin`)]).toEqual([first, first + 1, first + 2])
  })

  test("nvm's entries that are not a version folder are left out", async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], {
      nvm: [dir('v22.17.0'), { name: '.DS_Store', kind: 'file' }, { name: 'current', kind: 'other' }, dir('system'), { name: 'v20.0.0', kind: 'file' }],
    })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, `${NVM}/v22.17.0/bin`, ...AFTER_NVM].join(':') })
  })

  test('no nvm folder: the other folders alone after the host PATH', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)])
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, ...AFTER_NVM].join(':') })
  })

  test('a folder already on the host PATH is not repeated: the host keeps its place', async ($, on) => {
    const host = `/opt/homebrew/bin:${HOME}/.local/bin:/usr/bin:/bin`
    const { envs } = await world($, on, [view(LINE)], { env: { PATH: host, HOME } })
    expect(envs[0]).toEqual({
      PATH: [host, `${HOME}/.volta/bin`, `${HOME}/.local/share/pnpm`, `${HOME}/Library/pnpm`, `${HOME}/.bun/bin`, `${HOME}/.npm-global/bin`, '/usr/local/bin'].join(':'),
    })
  })

  test('no HOME: the host PATH, then the absolute folders', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { env: { PATH: BARE_PATH } })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(':') })
  })

  test('no host PATH: the folders, then /usr/bin and /bin', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { env: { HOME } })
    expect(envs[0]).toEqual({ PATH: [...AFTER_NVM, '/usr/bin', '/bin'].join(':') })
  })

  test("an empty segment of the host PATH (the current folder, to a shell) is dropped", async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { env: { PATH: ':/usr/bin::/bin:', HOME } })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, ...AFTER_NVM].join(':') })
  })

  test('an empty HOME is no HOME: no folder under it', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { env: { PATH: BARE_PATH, HOME: '' } })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(':') })
  })

  test('Windows: nothing is handed, as before', async ($, on) => {
    const { envs, argvs } = await world($, on, [view(LINE)], { env: { OS: 'Windows_NT', PATH: 'C:\\Windows\\system32;C:\\Windows', HOME } })
    expect(argvs).toHaveLength(1)
    expect(envs[0]).toBeUndefined()
  })

  test('every run is handed the same PATH', async ($, on) => {
    const { envs, clock } = await world($, on, [view(LINE)], { nvm: [dir('v22.17.0')] })
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(envs).toHaveLength(3)
    expect(envs[0]?.PATH).toContain(`${NVM}/v22.17.0/bin`)
    expect(new Set(envs.map((e) => e?.PATH)).size).toBe(1)
  })

  test("nvm's folder is listed once per load, not per run", async ($, on) => {
    const { lists, clock } = await world($, on, [view(LINE)], { nvm: [dir('v22.17.0')] })
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(lists).toEqual([NVM])
  })

  test('the argument vector and the empty stdin are unchanged', async ($, on) => {
    const { argvs, stdins } = await world($, on, [view(LINE)], { nvm: [dir('v22.17.0')] })
    expect(argvs).toEqual([['claudinho', 'ambient', '--json', '--columns', '80']])
    expect(stdins).toEqual([''])
  })

  test('the CLI found in none of them stays silent: nothing shown', async ($, on) => {
    const { mount } = await world($, on, [new Error('$.process.run(claudinho) failed to start: ENOENT: Executable not found in $PATH: "claudinho"')])
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('the nvm lookup is bounded', () => {
  test('a listing that never answers: the first run goes on after a second, with no nvm folder', async ($, on) => {
    const { argvs, clock, envs } = await world($, on, [view(LINE)], { nvm: 'hold' })
    await clock.advance(900)
    expect(argvs).toHaveLength(0)
    await clock.advance(200)
    expect(argvs).toHaveLength(1)
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, ...AFTER_NVM].join(':') })
  })

  test('a probe for the CLI that never answers: the first run goes on after a second, with no nvm folder', async ($, on) => {
    const { argvs, clock, envs } = await world($, on, [view(LINE)], { nvm: [dir('v22.17.0')], bins: 'hold' })
    await clock.advance(900)
    expect(argvs).toHaveLength(0)
    await clock.advance(200)
    expect(argvs).toHaveLength(1)
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, ...AFTER_NVM].join(':') })
  })

  test("300 version folders: the listing's first 256 are read, and the 8 newest of them kept", async ($, on) => {
    const many = Array.from({ length: 300 }, (_, i) => dir(`v${i + 1}.0.0`))
    const { envs } = await world($, on, [view(LINE)], { nvm: many })
    const kept = Array.from({ length: 8 }, (_, i) => `${NVM}/v${256 - i}.0.0/bin`)
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, ...kept, ...AFTER_NVM].join(':') })
  })
})

describe("nvm's folders that hold the CLI come first", () => {
  test('the CLI in an older version only: that folder first, so the node beside the CLI is the one it was installed with', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { nvm: [dir('v24.11.1'), dir('v22.17.0')], bins: [`${NVM}/v22.17.0/bin/claudinho`] })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, `${NVM}/v22.17.0/bin`, `${NVM}/v24.11.1/bin`, ...AFTER_NVM].join(':') })
  })

  test('the CLI in no nvm folder (pnpm, bun, npm-global): every nvm version stays, for its node', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { nvm: [dir('v22.17.0')], bins: [] })
    expect((envs[0]?.PATH ?? '').split(':')).toContain(`${NVM}/v22.17.0/bin`)
  })
})

describe('a HOME that is no absolute folder adds nothing under it', () => {
  test('a HOME holding the PATH separator', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { env: { PATH: BARE_PATH, HOME: '/Users/a:relative-home' } })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(':') })
  })

  test('a relative HOME', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], { env: { PATH: BARE_PATH, HOME: 'relative/home' } })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(':') })
  })
})

describe('the nvm lookup after its deadline, and a refused probe', () => {
  test('a listing that answers after the deadline is used by the next run: its folder holding the CLI first', async ($, on) => {
    const { clock, envs, lists, probes, releaseListing } = await world($, on, [view(LINE)], { nvm: 'hold', bins: [`${NVM}/v22.17.0/bin/claudinho`] })
    await clock.advance(1_100)
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, ...AFTER_NVM].join(':') })
    await releaseListing()
    await clock.advance(15_000)
    expect(envs[1]).toEqual({ PATH: [BARE_PATH, `${NVM}/v22.17.0/bin`, ...AFTER_NVM].join(':') })
    expect(lists).toEqual([NVM])
    expect(probes).toEqual([`${NVM}/v22.17.0/bin/claudinho`])
  })

  test('a listing that never answers: every run waits at most a second for it, and asks it once', async ($, on) => {
    const { argvs, clock, lists } = await world($, on, [view(LINE)], { nvm: 'hold' })
    await clock.advance(1_100)
    expect(argvs).toHaveLength(1)
    // The second fire is at 15 s; its run waits until 16 s.
    await clock.advance(14_800)
    expect(argvs).toHaveLength(1)
    await clock.advance(200)
    expect(argvs).toHaveLength(2)
    expect(lists).toEqual([NVM])
  })

  test('a probe that is refused counts as no CLI there: the folder whose probe found it stays first', async ($, on) => {
    const { envs } = await world($, on, [view(LINE)], {
      nvm: [dir('v24.11.1'), dir('v22.17.0')],
      bins: [`${NVM}/v22.17.0/bin/claudinho`],
      refusedProbes: [`${NVM}/v24.11.1/bin/claudinho`],
    })
    expect(envs[0]).toEqual({ PATH: [BARE_PATH, `${NVM}/v22.17.0/bin`, `${NVM}/v24.11.1/bin`, ...AFTER_NVM].join(':') })
  })
})
