import { mock, type test } from 'claude-code/testing'

/** The world beneath the plugin, shared by the test files (a helper module: a test file imported by another would run its tests again). */
export const START = { cwd: '/tmp/claudinho-test', surface: 'terminal', isInteractive: true } as const
export const PROPS = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as const
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
/** The clock's start: the views the tests build are stamped 15:00Z with a 15:05Z deadline. */
export const NOW = Date.parse('2026-10-10T15:00:00.000Z')
export const COMPLETE = '⚽ World Cup 2026 is complete · claudinho follow --list'
/** The host environment a test session starts with unless it says otherwise: a bare PATH, a home, no Windows. */
export const HOME = '/Users/fan'
export const BARE_PATH = '/usr/bin:/bin'
export const NVM = `${HOME}/.nvm/versions/node`

/** The view the CLI prints for a line, with nothing live: `idle` and `empty` SAY what the line is (the band never reads the text). */
export const view = (line: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    line,
    idle: false,
    empty: false,
    context: null,
    live: { items: [], total: 0, shown: 0, truncated: false, complete: true },
    current: false,
    next: null,
    pick: null,
    competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' },
    degraded: false,
    source: 'espn',
    updatedAt: null,
    staleAfter: null,
    disclaimer: 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.',
    attribution: 'Live data: ESPN',
    ...over,
  })

type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode'

/**
 * How the session starts, as measured on the engine (Oct 11, 2026): `start` is what `session.start` reports;
 * `surfaces` is the roster `$.session.surfaces()` answers at that moment (by default the start's own surface, or none),
 * each surface a client whose id is the surface's name; `attachFirst` attaches a client BEFORE `session.start` (a client
 * attaches on its first ask to draw) and lets its run start; `env` is the host's environment as `$.env.get` reads it (a
 * name absent from it is unset); `nvm` is what listing nvm's version folder answers (an Error: no such folder; `'hold'`:
 * no answer until the test releases it, or ever); `bins` are the files `$.fs.exists` finds (`'hold'`: it never answers);
 * `beneath` draws another plugin's band under ours.
 */
export type WorldOptions = {
  start?: { surface: Surface | null; isInteractive: boolean }
  surfaces?: Surface[]
  attachFirst?: { surface: Surface; clientId: string }
  env?: Record<string, string>
  nvm?: Array<{ name: string; kind: 'file' | 'dir' | 'other' }> | Error | 'hold'
  bins?: string[] | 'hold'
  /** The `$.fs.exists` probes that reject (a hook's `{ deny }`). */
  refusedProbes?: string[]
  beneath?: string
  /** The roster read rejects while `session.start` runs (a hook's `{ deny }`), then answers. */
  rosterDeniedAtStart?: boolean
  /**
   * The CLI's answers to `claudinho match ...` runs, in order (the last repeats), apart from the `ambient` answers;
   * absent: a `match` run takes the next `ambient` answer as before.
   */
  matchAnswers?: Answer[]
}

/** One answer of the CLI as a test scripts it. */
export type Answer = string | Error | { stdout: string; truncated: true } | { held: string } | { stdout: string; exitCode: number }

/** An answer of the CLI the test holds: the run waits until the test releases it (`release()` in the world's order). */
export const held = (stdout: string) => ({ held: stdout }) as const

/** The world beneath the plugin: a mock clock, the session started, the engine's own (empty) band, the CLI's answers in order. */
export const world = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  answers: Answer[],
  options: WorldOptions = {},
) => {
  const start = options.start ?? { surface: START.surface, isInteractive: START.isInteractive }
  // The roster the engine holds, by client: the session's own surface at start (its id the surface's name), plus every
  // client attached, less every detached. `$.session.surfaces()` answers each surface once, in the order attached.
  const clients = new Map<string, Surface>((options.surfaces ?? (start.surface ? [start.surface] : [])).map((s) => [s, s]))
  const roster = (): Surface[] => [...new Set(clients.values())]
  let rosterRejects = false
  const env: Record<string, string> = options.env ?? { PATH: BARE_PATH, HOME }
  const nvm = options.nvm ?? new Error(`ENOENT: no such file or directory, scandir '${NVM}'`)
  let releaseNvm: () => void = () => {}
  const nvmHeld = nvm === 'hold' ? new Promise<void>((resolve) => { releaseNvm = resolve }) : null
  // The clock starts at a fixed instant, five minutes before the views' `staleAfter` (15:05Z): the context's deadline
  // is then a property of the test, never of the wall clock the kit might start from.
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', (_$, e) => ({ clientId: e.clientId }))
  let surfaceReads = 0
  // The slash commands the plugin registers, as the engine receives them; the engine answers with the name.
  const registrations: Array<Record<string, unknown>> = []
  on('command.register', (_$, e) => {
    registrations.push({ ...e })
    return { value: { command: e.name } }
  })
  // A model turn's two edges, as the engine answers them beneath every plugin.
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // Each redraw the plugin asks for, recorded (the engine folds them; a test counts the asks).
  const invalidates: string[] = []
  on('ui.invalidate', (_$, e) => {
    invalidates.push(String((e as { event?: unknown }).event ?? ''))
    return { value: undefined }
  })
  // The engine's own answer to a command the plugin does not answer (a built-in such as /cost, another plugin's).
  on('command.run', (_$, e) => ({ text: `engine ran /${e.command}` }))
  on('session.surfaces', () => {
    surfaceReads += 1
    // A refusal is `{ deny }`: a hook that throws is skipped, and the read would go on beneath it.
    if (rosterRejects) return { deny: 'session.surfaces denied' }
    return { value: roster() }
  })
  const envReads: string[] = []
  on('env.get', (_$, e) => {
    envReads.push(e.name)
    return { value: Object.hasOwn(env, e.name) ? env[e.name] : undefined }
  })
  const lists: string[] = []
  on('fs.list', async (_$, e) => {
    lists.push(e.path)
    if (e.path !== NVM) throw new Error(`ENOENT: no such file or directory, scandir '${e.path}'`)
    if (nvm instanceof Error) throw nvm
    // A held listing answers only once released (never, if the test does not), as one version folder, v22.17.0.
    if (nvm === 'hold') {
      await nvmHeld
      return { value: [{ name: 'v22.17.0', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }
    }
    return { value: nvm.map((d) => ({ ...d, size: 0, mtimeMs: 0, isLink: false })) }
  })
  const probes: string[] = []
  on('fs.exists', async (_$, e) => {
    probes.push(e.path)
    if (options.bins === 'hold') await new Promise(() => {})
    if (options.refusedProbes?.includes(e.path)) return { deny: 'fs.exists denied' }
    return { value: Array.isArray(options.bins) && options.bins.includes(e.path) }
  })
  // The engine's pane record, beneath the plugin: every open answered placed (an open the person's command made is
  // placed at any width, measured), every close recorded.
  const opens: Array<Record<string, unknown>> = []
  const closes: Array<Record<string, unknown>> = []
  on('ui.open', (_$, e) => {
    opens.push({ ...e })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closes.push({ ...e })
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Box, Text } = $$.ui.resolve(e)
    return options.beneath === undefined ? <Box /> : <Box><Text>{options.beneath}</Text></Box>
  })
  // The hooks beneath the plugin are registered before the test first calls `$`: the prompt's bottom answers as
  // the engine does (the text and the context that arrived).
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  const argvs: string[][] = []
  const stdins: Array<string | undefined> = []
  const envs: Array<Record<string, string> | undefined> = []
  const timeouts: Array<number | undefined> = []
  const releases: Array<() => void> = []
  let ambientRuns = 0
  let matchRunCount = 0
  on('process.run', async (_$, e) => {
    argvs.push([...e.argv])
    stdins.push(e.init?.stdin)
    envs.push(e.init?.env ? { ...e.init.env } : undefined)
    timeouts.push(e.init?.timeoutMs)
    const isMatch = options.matchAnswers !== undefined && e.argv[1] === 'match'
    const queue = isMatch ? (options.matchAnswers as Answer[]) : answers
    const n = isMatch ? matchRunCount++ : ambientRuns++
    const a = queue[Math.min(n, queue.length - 1)]
    if (a instanceof Error) throw a
    if (typeof a === 'object' && 'held' in a) {
      await new Promise<void>((resolve) => releases.push(resolve))
      return ok(`${a.held}\n`)
    }
    if (typeof a === 'object' && 'exitCode' in a) return { value: { ...ok(`${a.stdout}\n`).value, exitCode: a.exitCode } }
    if (typeof a === 'object') return { value: { ...ok(`${a.stdout}\n`).value, isStdoutTruncated: true } }
    return ok(`${a}\n`)
  })
  if (options.attachFirst) {
    clients.set(options.attachFirst.clientId, options.attachFirst.surface)
    await $.session.attach(options.attachFirst)
    // The attach's own run starts before the session's start arrives.
    await clock.advance(1)
  }
  rosterRejects = options.rosterDeniedAtStart === true
  await $.session.start({ cwd: START.cwd, ...start })
  rosterRejects = false
  await clock.advance(1)
  /** A client attaches (the roster gains it), then the clock lets the run it starts begin. */
  const attach = async (surface: Surface, clientId: string) => {
    clients.set(clientId, surface)
    await $.session.attach({ surface, clientId })
    await clock.advance(1)
  }
  /** A client leaves by the id it attached under (a starting surface's id is its name); the roster loses it. */
  const detach = async (clientId: string) => {
    const surface = clients.get(clientId)
    if (surface === undefined) throw new Error(`no client ${clientId}`)
    clients.delete(clientId)
    await $.session.detach({ surface, clientId, reason: 'detach' })
  }
  /** The CLI's held answers, released in the order the runs began; then the clock lets the run finish. */
  const release = async () => {
    const r = releases.shift()
    if (!r) throw new Error('no held answer')
    r()
    await clock.advance(1)
  }
  /** nvm's held listing answers now. */
  const releaseListing = async () => {
    releaseNvm()
    await clock.advance(1)
  }
  /** From now on, the roster read rejects (`true`) or answers (`false`). */
  const denyRoster = (deny: boolean) => {
    rosterRejects = deny
  }
  const mount = (props: Partial<typeof PROPS> = {}, surface: 'terminal' | 'desktop' = 'terminal') =>
    $.ui.mount({ plugin: 'claudinho', surface, component: 'AbovePrompt', props: { ...PROPS, ...props }, viewport: { columns: 100, rows: 30 } })
  /** The person runs `/claudinho` (with `args` typed after it) at the composer, as the engine raises it; resolves to its reply. */
  const command = (args = '') =>
    $.command.run({ command: 'claudinho', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  /** A main-loop model turn starts (Enter at the prompt), or ends (`agentId` set: a subagent's turn ends instead). */
  const turnStart = (turnId = 't1') => $.turn.start({ text: 'hi', turnId })
  const turnEnd = (turnId = 't1', agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer', ...(agentId ? { agentId } : {}) } as Parameters<typeof $.turn.complete>[0])
  /** How many times the plugin asked for the roster: what a timer ticking for nobody would show. */
  const rosterReads = () => surfaceReads
  /** The match pane drawn on a surface, at the measured sizes (terminal dock 71 x 34; Desktop dock 65 x 55). */
  const mountPane = (surface: 'terminal' | 'desktop' = 'terminal') =>
    $.ui.mount({
      plugin: 'claudinho',
      surface,
      component: 'Pane',
      requestId: 'match',
      props: { title: 'claudinho', isFocused: false, bodyColumns: surface === 'terminal' ? 71 : 65, placement: 'dock', scroll: { offset: 0, bodyRows: surface === 'terminal' ? 34 : 55 }, view: {} },
      viewport: { columns: surface === 'terminal' ? 88 : 106, rows: 40, isFullscreen: true },
    } as Parameters<typeof $.ui.mount>[0])
  /** The `match` runs so far (their argv). */
  const matchRuns = () => argvs.filter((a) => a[1] === 'match')
  return { clock, argvs, stdins, envs, timeouts, invalidates, turnStart, turnEnd, envReads, lists, probes, registrations, command, mount, attach, detach, release, releaseListing, denyRoster, rosterReads, opens, closes, mountPane, matchRuns }
}

/** The first-run object the CLI prints with no competition chosen: no view, the one line, its own key. */
export const FIRST_RUN = JSON.stringify({ competition: null, noCompetition: true, line: '⚽ claudinho follow' })
