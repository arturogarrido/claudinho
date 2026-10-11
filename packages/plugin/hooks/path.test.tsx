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
    expect([parts.indexOf(`${NVM}/v24.11.1/bin`), parts.indexOf(`${NVM}/v22.17.0/bin`), parts.indexOf(`${NVM}/v9.0.0/bin`)]).toEqual([1, 2, 3])
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
