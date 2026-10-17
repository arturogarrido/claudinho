import { describe, expect, test } from 'claude-code/testing'
import { WIDTH_CORPUS } from './width-corpus'
import { NOW, drawnRows, view, world } from './world'

/**
 * The match pane in a narrow dock (plugin 0.5.x): the CLI's styled rows laid out at the pane's own width, the engine's
 * `bodyColumns` (W). The design the maintainer reviewed:
 *  R1. A named event row (role `event`, more than one part, the last one `strong`: the player) wider than W is drawn as
 *      two rows: the row without its last part, trailing spaces trimmed, then the player bold on the next row, indented
 *      to the event label's column (the width of the first part up to and including the marker and the space after it).
 *  R2. When ANY named event row of the answer is wider than W, EVERY named event row of it is drawn that way; when all
 *      fit, none is.
 *  R3. An event row with no player (one part) is never split.
 *  R4. Every other row wider than W continues under its own first non-space character, never at column 0.
 *  R5. A pane wide enough for every row draws exactly today's rows. R6. A lines-only answer (CLI 0.11.2) is drawn as
 *      today. R7. The footer and the fixed sentences are unchanged. R8. The same on the desktop. R9. No `bodyColumns`,
 *      or one that is not a positive integer: nothing is split.
 *
 * The kit reads a drawing as its element tree, never as a surface's paint ("never a surface's paint (Ink's, the
 * desktop page's)", the kit's own header), so what the person sees is asserted through `paint` below: a small model of
 * how a column of rows is laid out at a width, which reads the tree the plugin returned. It knows a column `Box`, a row
 * `Box` (its children side by side: every child but the last keeps its own width and must say `flexShrink: 0`, the
 * last takes the rest), `paddingLeft`/`marginLeft`, and a `Text` that wraps by words (the default) or truncates; any
 * other horizontal layout prop is refused by name (the model does not guess how the engine would lay it out).
 */
const LINE = "⚽ BRE 1–2 LIV 90'"
const D = 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.'
const A = 'Live data: ESPN'
const ID = '401879286'
const STALE_AFTER = new Date(NOW + 5 * 60_000).toISOString()
const NARROW = 38

type Part = { text: string; style?: 'strong' | 'dim' | 'flair' | 'accent' | 'quote' }
type Row = { role: string; parts: Part[] }

/** A current view with the bound match live and pinned. */
const live = () =>
  view(LINE, {
    current: true,
    staleAfter: STALE_AFTER,
    live: { items: [{ id: ID, line: "Brentford 1–2 Liverpool (90')", score: { home: 1, away: 2 }, pinned: true, picked: true }], total: 1, shown: 1, truncated: false, complete: true },
  })

const joined = (rows: Row[]) => rows.map((r) => r.parts.map((p) => p.text).join(''))
/** What `claudinho match <id> --json` prints (CLI 0.12.0): `rows` beside `lines`, the parts joining to each line. */
const answer = (rows: Row[] | null, lines: string[] = rows ? joined(rows) : []) =>
  JSON.stringify(
    {
      degraded: false,
      match: { id: ID, status: 'FT', kickoff: new Date(NOW - 110 * 60_000).toISOString(), score: { home: 1, away: 2 } },
      source: 'espn',
      marketComplete: true,
      marketSignal: null,
      lines,
      ...(rows ? { rows } : {}),
      attribution: A,
      disclaimer: D,
      competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' },
    },
    null,
    2,
  )

const ev = (columns: string, player?: string): Row => ({ role: 'event', parts: player === undefined ? [{ text: columns }] : [{ text: columns }, { text: player, style: 'strong' }] })

/** Brentford 1–2 Liverpool, as CLI 0.12.0 printed it (the samples kept exactly). */
const EN_HEAD: Row[] = [
  { role: 'title', parts: [{ text: 'Brentford ' }, { text: '1–2', style: 'strong' }, { text: ' ' }, { text: 'Liverpool' }] },
  { role: 'mode', parts: [{ text: '  Premier League', style: 'dim' }] },
  { role: 'meta', parts: [{ text: '  ' }, { text: 'League · Gtech Community Stadium, Brentford, England', style: 'dim' }] },
  { role: 'status', parts: [{ text: '  ' }, { text: 'FT', style: 'strong' }, { text: ' · ', style: 'dim' }, { text: 'Kickoff Sat 07:00', style: 'dim' }] },
  { role: 'flair', parts: [{ text: '  ' }, { text: "You'll never walk alone!", style: 'flair' }] },
  { role: 'blank', parts: [] },
]
const EN_EVENTS: Row[] = [
  ev("  31'    🟨 Yellow card  LIV  ", 'Bradley Barcola'),
  ev("  44'    ⚽ Goal         BRE  ", 'Keane Lewis-Potter'),
  ev("  45+8'  🟥 Red card     BRE  ", 'Yehor Yarmoliuk'),
  ev("  62'    ⚽ Goal         LIV  ", 'Víctor Muñoz'),
  ev("  70'    ⚽ Goal         LIV  ", 'Alexander Isak'),
]
const EN: Row[] = [...EN_HEAD, ...EN_EVENTS]

/** Atlante 1–2 Pumas UNAM (Spanish), the samples kept exactly. */
const ES: Row[] = [
  { role: 'title', parts: [{ text: 'Atlante ' }, { text: '1–2', style: 'strong' }, { text: ' ' }, { text: 'Pumas UNAM' }] },
  { role: 'meta', parts: [{ text: '  ' }, { text: 'Liga · Estadio Banorte, Mexico City, Mexico', style: 'dim' }] },
  { role: 'blank', parts: [] },
  ev("  34'    🟨 Tarjeta amarilla  ATL"),
  ev("  42'    ⚽ Gol               UNAM  ", 'Juninho'),
  ev("  45+1'  ⚽ Gol               ATL   ", 'Luis Calzadilla'),
]

/** A short named row that fits a 38-column pane on its own, and an unnamed card. */
const RODRI = ev("  41'  ⚽ Goal         BAR  ", 'Rodri')
const CARD = ev("  45'    🟨 Yellow card  BET")

// ---- widths and the layout model ----

/**
 * The model's display width: core's `displayWidth` (packages/core/src/text.ts), copied for the model's own use and
 * checked against the shared corpus below (grapheme clusters; an emoji cluster, both flag encodings and a keycap 2; an
 * East Asian wide or fullwidth base 2; a combining mark, a format or a control base 0; else 1).
 */
const SEGMENTER = new Intl.Segmenter()
const WIDE_CLUSTER = /^(?:\p{Regional_Indicator}|\p{Extended_Pictographic})/u
const WIDE_BASE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u
const KEYCAP = /⃣/u
const ZERO_WIDTH_BASE = /[\p{Mn}\p{Me}\p{Cf}\p{Cc}]/u
const clusterWidth = (segment: string) => {
  if (WIDE_CLUSTER.test(segment) || KEYCAP.test(segment)) return 2
  const first = segment.codePointAt(0)
  if (first === undefined) return 0
  const base = String.fromCodePoint(first)
  if (ZERO_WIDTH_BASE.test(base)) return 0
  return WIDE_BASE.test(base) ? 2 : 1
}
const width = (s: string) => [...SEGMENTER.segment(s)].reduce((n, { segment }) => n + clusterWidth(segment), 0)
const leading = (s: string) => s.length - s.trimStart().length

/** Greedy word wrap at `w` columns: a break drops the spaces it falls on; a word wider than `w` is cut. */
const wrapAt = (text: string, w: number): string[] => {
  if (width(text) <= w) return [text]
  const lines: string[] = []
  let cur = ''
  for (const tok of text.match(/ +|[^ ]+/g) ?? []) {
    if (tok.startsWith(' ')) {
      if (cur === '' && lines.length > 0) continue
      cur += tok
      continue
    }
    if (width(cur + tok) <= w) {
      cur += tok
      continue
    }
    if (cur.trim() !== '') {
      lines.push(cur.trimEnd())
      cur = ''
    }
    let s = cur + tok
    while (width(s) > w) {
      let cut = ''
      for (const c of s) {
        if (width(cut + c) > w) break
        cut += c
      }
      if (cut === '') break
      lines.push(cut)
      s = s.slice(cut.length)
    }
    cur = s
  }
  if (cur !== '' || lines.length === 0) lines.push(cur.trimEnd())
  return lines
}

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' && Array.isArray((n as Node).children) ? ((n as Node).children as unknown[]).map(textOf).join('') : '')
const REFUSED_BOX_PROPS = ['width', 'minWidth', 'maxWidth', 'flexBasis', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf', 'gap', 'columnGap', 'margin', 'marginX', 'marginRight', 'padding', 'paddingX', 'paddingRight', 'borderStyle', 'position']
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The lines a node lays out at `w` columns (plain text, trailing spaces kept until `paint` trims them). */
const layout = (n: unknown, w: number): string[] => {
  if (typeof n === 'string') return wrapAt(n, w)
  if (n === null || typeof n !== 'object') return []
  const d = n as Node
  const props = d.props ?? {}
  if (d.type === 'Text') {
    const t = textOf(d)
    if (typeof props.wrap === 'string' && props.wrap.startsWith('truncate')) return wrapAt(t, w).slice(0, 1)
    return t.split('\n').flatMap((l) => wrapAt(l, w))
  }
  if (d.type !== 'Box') throw new Error(`the layout model does not read a ${String(d.type)}`)
  if (props.display === 'none') return []
  for (const k of REFUSED_BOX_PROPS) if (props[k] !== undefined) throw new Error(`the layout model does not read the Box prop ${k}`)
  const indent = num(props.paddingLeft) + num(props.marginLeft)
  const inner = w - indent
  const kids = (d.children ?? []).filter((c) => c !== null && c !== undefined && c !== false)
  let lines: string[]
  if (props.flexDirection === 'column') lines = kids.flatMap((k) => layout(k, inner))
  else if (kids.length <= 1) lines = kids.flatMap((k) => layout(k, inner))
  else {
    const fixed = kids.slice(0, -1).map((k) => {
      if (typeof k === 'string' || (k as Node).props?.flexShrink !== 0) throw new Error('the layout model refuses a row whose leading children may shrink (flexShrink is not 0)')
      const ls = layout(k, Number.POSITIVE_INFINITY)
      return { ls, w: Math.max(0, ...ls.map(width)) }
    })
    const rest = layout(kids.at(-1), inner - fixed.reduce((s, f) => s + f.w, 0))
    const height = Math.max(rest.length, ...fixed.map((f) => f.ls.length))
    lines = Array.from({ length: height }, (_, i) => fixed.map((f) => { const s = f.ls[i] ?? ''; return s + ' '.repeat(Math.max(0, f.w - width(s))) }).join('') + (rest[i] ?? ''))
  }
  return lines.map((l) => ' '.repeat(indent) + l)
}

type Mounted = Awaited<ReturnType<Awaited<ReturnType<typeof world>>['mountPane']>>
/** What the person sees in the pane at `w` columns, by the model above: one string per painted line, trailing spaces trimmed. */
const paint = async (pane: Mounted, w: number) => layout(await pane.drawn(), w).map((l) => l.trimEnd())

/** The event label's column in a named row: the first part's width through the marker and the one space after it. */
const labelColumn = (columns: string) => {
  const m = columns.match(/^(.*?[⚽\u{1F300}-\u{1FAFF}]) /u)
  if (!m) throw new Error(`no marker in ${JSON.stringify(columns)}`)
  return width(m[0])
}
const isNamed = (r: Row) => r.role === 'event' && r.parts.length > 1 && r.parts.at(-1)?.style === 'strong'

/** The design's lines for a whole answer at W (R1, R2, R4), then the footer. */
const designed = (rows: Row[], w: number): string[] => {
  const split = rows.some((r) => isNamed(r) && width(joined([r])[0] as string) > w)
  const out: string[] = []
  for (const r of rows) {
    const text = joined([r])[0] as string
    if (r.parts.length === 0) out.push('')
    else if (split && isNamed(r)) {
      out.push(r.parts.slice(0, -1).map((p) => p.text).join('').trimEnd())
      out.push(' '.repeat(labelColumn(r.parts[0]?.text as string)) + (r.parts.at(-1)?.text as string))
    } else if (width(text) <= w) out.push(text)
    else {
      const n = leading(text)
      for (const l of wrapAt(text.slice(n), w - n)) out.push(' '.repeat(n) + l)
    }
  }
  out.push('', ...wrapAt(A, w), ...wrapAt(D, w))
  return out
}

/** `lines` holds `sub` as consecutive lines. */
const holdsRun = (lines: string[], sub: string[]) => lines.some((_, i) => sub.every((s, j) => lines[i + j] === s))

/** The Text elements whose shown text, trimmed, is `text`. */
const shown = async (pane: Mounted, text: string) => (await pane.findAll({ type: 'Text' })).filter((t) => t.text.trim() === text)
const trimmedRows = async (pane: Mounted) => (await drawnRows(pane)).map((r) => (r.trim() === '' ? '' : r))

/** The pane, opened on `rows` (or a lines-only answer), drawn at `w`. */
const open = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], a: string, surface: 'terminal' | 'desktop' = 'terminal', w?: Parameters<Awaited<ReturnType<typeof world>>['mountPane']>[1]) => {
  const wd = await world($, on, [live()], { matchAnswers: [a] })
  await wd.command('match')
  return wd.mountPane(surface, w)
}

describe('the layout model (the fixtures\' own widths, checked before the rules use them)', () => {
  test('the samples measure as the design states: every English named row is wider than 38, Rodri fits, the widest is 48', async () => {
    expect(EN_EVENTS.map((r) => width(joined([r])[0] as string))).toEqual([45, 48, 45, 42, 44])
    expect(width(joined([RODRI])[0] as string)).toBe(33)
    expect(labelColumn("  44'    ⚽ Goal         BRE  ")).toBe(12)
    expect(labelColumn("  45+8'  🟥 Red card     BRE  ")).toBe(12)
    expect(labelColumn("  41'  ⚽ Goal         BAR  ")).toBe(10)
  })
})

describe('R1: a named event row wider than the pane is drawn as two rows', () => {
  test('English at 38: the row without the player, trimmed, then the player under the label\'s column', async ($, on) => {
    const lines = await paint(await open($, on, answer(EN), 'terminal', NARROW), NARROW)
    expect(holdsRun(lines, ["  44'    ⚽ Goal         BRE", `${' '.repeat(12)}Keane Lewis-Potter`])).toBe(true)
    expect(holdsRun(lines, ["  45+8'  🟥 Red card     BRE", `${' '.repeat(12)}Yehor Yarmoliuk`])).toBe(true)
  })
  test('English at 38: every line the event rows paint fits the pane, none starts at column 0', async ($, on) => {
    const lines = await paint(await open($, on, answer(EN), 'terminal', NARROW), NARROW)
    const events = lines.slice(lines.indexOf("  31'    🟨 Yellow card  LIV"), lines.lastIndexOf('') )
    expect(events).toEqual([
      "  31'    🟨 Yellow card  LIV",
      `${' '.repeat(12)}Bradley Barcola`,
      "  44'    ⚽ Goal         BRE",
      `${' '.repeat(12)}Keane Lewis-Potter`,
      "  45+8'  🟥 Red card     BRE",
      `${' '.repeat(12)}Yehor Yarmoliuk`,
      "  62'    ⚽ Goal         LIV",
      `${' '.repeat(12)}Víctor Muñoz`,
      "  70'    ⚽ Goal         LIV",
      `${' '.repeat(12)}Alexander Isak`,
    ])
  })
  test('English at 38: the player\'s row is bold, the row before it is not', async ($, on) => {
    const pane = await open($, on, answer(EN), 'terminal', NARROW)
    expect((await shown(pane, 'Keane Lewis-Potter')).some((t) => t.props.bold === true)).toBe(true)
    const head = (await pane.findAll({ type: 'Text' })).filter((t) => t.text === "  44'    ⚽ Goal         BRE")
    expect(head.length).toBeGreaterThan(0)
    for (const t of head) expect(t.props.bold).not.toBe(true)
  })
  test('English at 38: the player is its own drawn row (the element tree), never on the event\'s row', async ($, on) => {
    const rows = await trimmedRows(await open($, on, answer(EN), 'terminal', NARROW))
    expect(rows).not.toContain("  44'    ⚽ Goal         BRE  Keane Lewis-Potter")
    expect(rows).toContain("  44'    ⚽ Goal         BRE")
    expect(rows.some((r) => r.trim() === 'Keane Lewis-Potter')).toBe(true)
  })
  test('Spanish at 38: the two goals split under the label\'s column, the card left whole', async ($, on) => {
    const lines = await paint(await open($, on, answer(ES), 'terminal', NARROW), NARROW)
    const from = lines.indexOf("  34'    🟨 Tarjeta amarilla  ATL")
    expect(from).toBeGreaterThanOrEqual(0)
    expect(lines.slice(from, from + 5)).toEqual([
      "  34'    🟨 Tarjeta amarilla  ATL",
      "  42'    ⚽ Gol               UNAM",
      `${' '.repeat(12)}Juninho`,
      "  45+1'  ⚽ Gol               ATL",
      `${' '.repeat(12)}Luis Calzadilla`,
    ])
  })
  test('Spanish at 38: each player is a bold row of its own', async ($, on) => {
    const pane = await open($, on, answer(ES), 'terminal', NARROW)
    const rows = await trimmedRows(pane)
    for (const name of ['Juninho', 'Luis Calzadilla']) {
      expect(rows.some((r) => r.trim() === name)).toBe(true)
      expect((await shown(pane, name)).some((t) => t.props.bold === true)).toBe(true)
    }
  })
  test('the whole English pane at 38 paints as designed', async ($, on) => {
    expect(await paint(await open($, on, answer(EN), 'terminal', NARROW), NARROW)).toEqual(designed(EN, NARROW))
  })
  test('the whole Spanish pane at 38 paints as designed', async ($, on) => {
    expect(await paint(await open($, on, answer(ES), 'terminal', NARROW), NARROW)).toEqual(designed(ES, NARROW))
  })
})

describe('R2: one named row too wide splits every named row of the answer', () => {
  test('at 38, the Rodri row (which fits on its own) splits beside a row that does not', async ($, on) => {
    const rows = [EN_HEAD[0] as Row, { role: 'blank', parts: [] }, RODRI, EN_EVENTS[1] as Row]
    const lines = await paint(await open($, on, answer(rows), 'terminal', NARROW), NARROW)
    expect(holdsRun(lines, ["  41'  ⚽ Goal         BAR", `${' '.repeat(10)}Rodri`, "  44'    ⚽ Goal         BRE", `${' '.repeat(12)}Keane Lewis-Potter`])).toBe(true)
  })
  test('at 38, every named row fits: none is split, each drawn as one row', async ($, on) => {
    const rows = [EN_HEAD[0] as Row, { role: 'blank', parts: [] }, RODRI, CARD]
    const pane = await open($, on, answer(rows), 'terminal', NARROW)
    expect(await trimmedRows(pane)).toEqual([...joined(rows), '', A, D])
    expect(await paint(pane, NARROW)).toEqual(designed(rows, NARROW))
    expect(await paint(pane, NARROW)).toContain("  41'  ⚽ Goal         BAR  Rodri")
  })
})

describe('R3: an event row with no player is never split', () => {
  test('at 38 beside split rows, the unnamed card is one drawn row with its text whole', async ($, on) => {
    const rows = [EN_HEAD[0] as Row, { role: 'blank', parts: [] }, CARD, EN_EVENTS[1] as Row]
    const pane = await open($, on, answer(rows), 'terminal', NARROW)
    expect(await trimmedRows(pane)).toContain("  45'    🟨 Yellow card  BET")
    expect(await paint(pane, NARROW)).toContain("  45'    🟨 Yellow card  BET")
    expect((await pane.findAll({ type: 'Text' })).some((t) => t.text === "  45'    🟨 Yellow card  BET")).toBe(true)
  })
})

describe('R4: any other row wider than the pane continues under its own first non-space character', () => {
  test('English at 38: the venue row\'s continuation keeps its 2-column indent', async ($, on) => {
    const lines = await paint(await open($, on, answer(EN), 'terminal', NARROW), NARROW)
    expect(holdsRun(lines, ['  League · Gtech Community Stadium,', '  Brentford, England'])).toBe(true)
    expect(lines).not.toContain('Brentford, England')
  })
  test('Spanish at 38: the venue row\'s continuation keeps its 2-column indent', async ($, on) => {
    const lines = await paint(await open($, on, answer(ES), 'terminal', NARROW), NARROW)
    expect(holdsRun(lines, ['  Liga · Estadio Banorte, Mexico City,', '  Mexico'])).toBe(true)
  })
  test('English at 38: the venue keeps its dim style', async ($, on) => {
    const pane = await open($, on, answer(EN), 'terminal', NARROW)
    const els = await pane.findAll({ type: 'Text' })
    const dim = els.filter((t) => t.props.dimColor === true).map((t) => t.text).join(' ')
    for (const word of ['League', 'Gtech', 'Community', 'Stadium,', 'Brentford,', 'England']) expect(dim).toContain(word)
  })
  test('a row that fits is drawn as today (the title, the status, the flair at 38)', async ($, on) => {
    const lines = await paint(await open($, on, answer(EN), 'terminal', NARROW), NARROW)
    expect(lines.slice(0, 2)).toEqual(['Brentford 1–2 Liverpool', '  Premier League'])
    expect(lines).toContain('  FT · Kickoff Sat 07:00')
    expect(lines).toContain("  You'll never walk alone!")
  })
})

describe('the boundary: a named row exactly as wide as the pane fits', () => {
  test('English at 48 (the widest row, the marker counted as 2): nothing is split', async ($, on) => {
    // (The venue row, 54 wide, still continues under its indent at 48: R4; only the event rows are asked here.)
    const pane = await open($, on, answer(EN), 'terminal', 48)
    const rows = await trimmedRows(pane)
    const lines = await paint(pane, 48)
    for (const line of joined(EN_EVENTS)) {
      expect(rows).toContain(line)
      expect(lines).toContain(line)
    }
    for (const r of EN_EVENTS) expect(rows.some((x) => x.trim() === r.parts.at(-1)?.text)).toBe(false)
  })
  test('English at 47 (one column narrower): every named row is split', async ($, on) => {
    const lines = await paint(await open($, on, answer(EN), 'terminal', 47), 47)
    expect(holdsRun(lines, ["  44'    ⚽ Goal         BRE", `${' '.repeat(12)}Keane Lewis-Potter`])).toBe(true)
    expect(holdsRun(lines, ["  62'    ⚽ Goal         LIV", `${' '.repeat(12)}Víctor Muñoz`])).toBe(true)
  })
})

describe('R5: a pane wide enough for every row draws today\'s rows', () => {
  test('terminal at 71: one drawn row per CLI row, the same text, then the footer', async ($, on) => {
    const pane = await open($, on, answer(EN))
    expect(await trimmedRows(pane)).toEqual([...joined(EN), '', A, D])
  })
  test('terminal at 71: the styles as today (score and players bold, mode and venue dim, the cry success)', async ($, on) => {
    const pane = await open($, on, answer(EN))
    const els = await pane.findAll({ type: 'Text' })
    const exactly = (text: string) => els.filter((t) => t.text === text)
    expect(exactly('1–2').some((t) => t.props.bold === true)).toBe(true)
    expect(exactly('Keane Lewis-Potter').some((t) => t.props.bold === true)).toBe(true)
    expect(exactly('  Premier League').some((t) => t.props.dimColor === true)).toBe(true)
    expect(exactly('League · Gtech Community Stadium, Brentford, England').some((t) => t.props.dimColor === true)).toBe(true)
    expect(exactly("You'll never walk alone!").some((t) => t.props.color === 'success')).toBe(true)
  })
})

describe('R6: an answer with no styled rows (CLI 0.11.2) is drawn as today', () => {
  test('terminal at 38: the lines verbatim, one Text each, then the footer', async ($, on) => {
    const pane = await open($, on, answer(null, joined(EN)), 'terminal', NARROW)
    const els = await pane.findAll({ type: 'Text' })
    expect(els.map((t) => (t.text.trim() === '' ? '' : t.text))).toEqual([...joined(EN), '', A, D])
    expect(await trimmedRows(pane)).toEqual([...joined(EN), '', A, D])
  })
})

describe('R7: the footer and the fixed sentences are unchanged', () => {
  test('at 38 with split rows: a blank row, then the attribution and the disclaimer dimmed, last', async ($, on) => {
    const pane = await open($, on, answer(EN), 'terminal', NARROW)
    const els = await pane.findAll({ type: 'Text' })
    expect(els.at(-1)?.text).toBe(D)
    expect(els.at(-1)?.props.dimColor).toBe(true)
    expect(els.at(-2)?.text).toBe(A)
    expect(els.at(-2)?.props.dimColor).toBe(true)
    expect((await trimmedRows(pane)).slice(-3)).toEqual(['', A, D])
  })
  test('at 38, a first read that failed: the one sentence', async ($, on) => {
    const wd = await world($, on, [live()], { matchAnswers: [new Error('timeout')] })
    await wd.command('match')
    const pane = await wd.mountPane('terminal', NARROW)
    expect((await pane.findAll({ type: 'Text' })).map((t) => t.text)).toEqual(['The CLI gave no answer.'])
  })
})

describe('R8: the same on the desktop', () => {
  test('desktop at 38: the named rows split under the label\'s column', async ($, on) => {
    const lines = await paint(await open($, on, answer(EN), 'desktop', NARROW), NARROW)
    expect(lines).toEqual(designed(EN, NARROW))
  })
  test('desktop at 38: the player is a bold row of its own', async ($, on) => {
    const pane = await open($, on, answer(EN), 'desktop', NARROW)
    expect((await trimmedRows(pane)).some((r) => r.trim() === 'Keane Lewis-Potter')).toBe(true)
    expect((await shown(pane, 'Keane Lewis-Potter')).some((t) => t.props.bold === true)).toBe(true)
  })
  test('desktop at its dock\'s 65: today\'s rows', async ($, on) => {
    const pane = await open($, on, answer(EN), 'desktop')
    expect(await trimmedRows(pane)).toEqual([...joined(EN), '', A, D])
  })
})

describe('R9: no usable width, nothing is split', () => {
  for (const [label, w] of [
    ['no bodyColumns prop', { absent: true }],
    ['bodyColumns 0', { value: 0 }],
    ['bodyColumns -38', { value: -38 }],
    ['bodyColumns 37.5', { value: 37.5 }],
    ['bodyColumns "38" (a string)', { value: '38' }],
    ['bodyColumns NaN', { value: Number.NaN }],
  ] as const) {
    test(`${label}: today's rows`, async ($, on) => {
      const pane = await open($, on, answer(EN), 'terminal', w)
      expect(await trimmedRows(pane)).toEqual([...joined(EN), '', A, D])
    })
  }
})

// ---- review round 1 of #184 ----

/** The Brentford goal's columns: 30 wide, so a player of width k makes a named row of 30 + k. */
const GOAL_COLUMNS = "  44'    ⚽ Goal         BRE  "
const TITLE = EN_HEAD[0] as Row
const BLANK: Row = { role: 'blank', parts: [] }
/** The text of every drawn row, its words in order (no word lost, whatever the layout). */
const words = (rows: string[]) => rows.join(' ').split(/\s+/).filter((x) => x !== '')

describe('F1/F2: the pane measures as core does (the shared width corpus)', () => {
  test("the layout model's width is core's on every corpus string", async () => {
    for (const c of WIDTH_CORPUS) expect({ what: c.what, width: width(c.text) }).toEqual({ what: c.what, width: c.width })
  })
  for (const c of WIDTH_CORPUS) {
    test(`${c.what}: a named row ${30 + c.width} wide in a pane ${30 + c.width} wide is one row`, async ($, on) => {
      const row = ev(GOAL_COLUMNS, c.text)
      const pane = await open($, on, answer([TITLE, BLANK, row]), 'terminal', 30 + c.width)
      expect(await trimmedRows(pane)).toEqual([...joined([TITLE, BLANK, row]), '', A, D])
    })
    test(`${c.what}: the same row in a pane ${29 + c.width} wide is split, the player its own row`, async ($, on) => {
      const row = ev(GOAL_COLUMNS, c.text)
      const rows = await trimmedRows(await open($, on, answer([TITLE, BLANK, row]), 'terminal', 29 + c.width))
      expect(rows).toContain("  44'    ⚽ Goal         BRE")
      expect(rows.some((r) => r.trim() === c.text)).toBe(true)
    })
  }

  /** A nation's named row with England's tag-sequence flag in its label column: core measures it 34 wide. */
  const ENG_ROW = ev("  44'  ⚽ Goal  \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} ENG  ", 'Harry Kane')
  test('a flag-carrying named row measures 34 by core', async () => {
    expect(width(joined([ENG_ROW])[0] as string)).toBe(34)
  })
  test('a flag-carrying named row in a pane exactly as wide (34): one row', async ($, on) => {
    const pane = await open($, on, answer([TITLE, BLANK, ENG_ROW]), 'terminal', 34)
    expect(await trimmedRows(pane)).toEqual([...joined([TITLE, BLANK, ENG_ROW]), '', A, D])
  })
  test('a flag-carrying named row in a pane one column narrower (33): split, the player under the label at 10', async ($, on) => {
    const lines = await paint(await open($, on, answer([TITLE, BLANK, ENG_ROW]), 'terminal', 33), 33)
    expect(holdsRun(lines, ["  44'  ⚽ Goal  \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} ENG", `${' '.repeat(10)}Harry Kane`])).toBe(true)
  })

  /** A CJK player (katakana, 14 columns): the named row is 44 wide. */
  const CJK_ROW = ev(GOAL_COLUMNS, 'ソン・フンミン')
  test('a CJK player at 38: the row is split, the player under the label at 12', async ($, on) => {
    const lines = await paint(await open($, on, answer([TITLE, BLANK, CJK_ROW]), 'terminal', NARROW), NARROW)
    expect(holdsRun(lines, ["  44'    ⚽ Goal         BRE", `${' '.repeat(12)}ソン・フンミン`])).toBe(true)
  })
  test('a CJK player at 38: the whole pane paints as designed', async ($, on) => {
    const rows = [TITLE, BLANK, CJK_ROW]
    expect(await paint(await open($, on, answer(rows), 'terminal', NARROW), NARROW)).toEqual(designed(rows, NARROW))
  })

  /** A CJK venue: core measures the row 47 wide. */
  const CJK_VENUE: Row = { role: 'meta', parts: [{ text: '  ' }, { text: 'League · 埼玉スタジアム2002, さいたま市, 日本', style: 'dim' }] }
  test('a CJK venue at 38: its continuation keeps the 2-column indent', async ($, on) => {
    expect(width(joined([CJK_VENUE])[0] as string)).toBe(47)
    const lines = await paint(await open($, on, answer([TITLE, CJK_VENUE]), 'terminal', NARROW), NARROW)
    expect(holdsRun(lines, ['  League · 埼玉スタジアム2002,', '  さいたま市, 日本'])).toBe(true)
  })
  test('a CJK venue at 38: the whole pane paints as designed', async ($, on) => {
    const rows = [TITLE, CJK_VENUE]
    expect(await paint(await open($, on, answer(rows), 'terminal', NARROW), NARROW)).toEqual(designed(rows, NARROW))
  })
})

describe('F3: a named event row needs all three: the role event, more than one part, the last part strong', () => {
  /** Beside a named row too wide for 38, so the split is on whatever the case row is. */
  const KEANE = EN_EVENTS[1] as Row
  const cases: Array<[string, Row]> = [
    ['a status row whose last part is strong (two parts)', { role: 'status', parts: [{ text: "  45+8'  🟥 Red card     BRE  " }, { text: 'Yehor Yarmoliuk', style: 'strong' }] }],
    ['an event row of one strong part', { role: 'event', parts: [{ text: "  45+8'  🟥 Red card     BRE  Yehor Yarmoliuk", style: 'strong' }] }],
    ['an event row of two parts whose last is not strong', { role: 'event', parts: [{ text: "  45+8'  🟥 Red card     BRE  " }, { text: 'Yehor Yarmoliuk' }] }],
  ]
  for (const [label, row] of cases) {
    test(`${label}: not split at 38; it continues under its indent as any long row`, async ($, on) => {
      const rows = [TITLE, BLANK, KEANE, row]
      const pane = await open($, on, answer(rows), 'terminal', NARROW)
      expect(await paint(pane, NARROW)).toEqual(designed(rows, NARROW))
      expect((await trimmedRows(pane)).some((r) => r.trim() === 'Yehor Yarmoliuk')).toBe(false)
    })
  }
})

describe("F4: an event row is one whose role is exactly 'event'", () => {
  for (const role of ['EVENT', 'event ', ' event', 'Event']) {
    test(`a role ${JSON.stringify(role)} with a strong player last: not a named row, not split at 38`, async ($, on) => {
      const KEANE = EN_EVENTS[1] as Row
      const row: Row = { role, parts: [{ text: "  45+8'  🟥 Red card     BRE  " }, { text: 'Yehor Yarmoliuk', style: 'strong' }] }
      const rows = [TITLE, BLANK, KEANE, row]
      const pane = await open($, on, answer(rows), 'terminal', NARROW)
      expect(await paint(pane, NARROW)).toEqual(designed(rows, NARROW))
      expect((await trimmedRows(pane)).some((r) => r.trim() === 'Yehor Yarmoliuk')).toBe(false)
    })
    test(`a role ${JSON.stringify(role)} alone too wide for 38 does not turn the split on for the event rows`, async ($, on) => {
      const row: Row = { role, parts: [{ text: "  45+8'  🟥 Red card     BRE  " }, { text: 'Yehor Yarmoliuk', style: 'strong' }] }
      const rows = [TITLE, BLANK, RODRI, row]
      const pane = await open($, on, answer(rows), 'terminal', NARROW)
      expect(await trimmedRows(pane)).toContain(joined([RODRI])[0] as string)
      expect(await paint(pane, NARROW)).toEqual(designed(rows, NARROW))
    })
  }
})

describe('F5: a pane at or below the label column', () => {
  /** A note row starting with 10 spaces, wider than either width (a row indent of w or more). */
  const DEEP: Row = { role: 'note', parts: [{ text: '          Not found between 2026-10-12 and 2026-10-27.' }] }
  for (const w of [12, 8]) {
    test(`bodyColumns ${w}: no Box indents by ${w} columns or more`, async ($, on) => {
      const pane = await open($, on, answer([...EN, DEEP]), 'terminal', w)
      for (const b of await pane.findAll({ type: 'Box' })) {
        const pl = b.props.paddingLeft
        if (pl !== undefined) expect(typeof pl === 'number' && pl < w).toBe(true)
        const ml = b.props.marginLeft
        if (ml !== undefined) expect(typeof ml === 'number' && ml < w).toBe(true)
      }
    })
    test(`bodyColumns ${w}: every row is still drawn, no word lost, the players their own rows`, async ($, on) => {
      const rows = [...EN, DEEP]
      const drawn = await trimmedRows(await open($, on, answer(rows), 'terminal', w))
      expect(words(drawn)).toEqual(words([...joined(rows), A, D]))
      for (const r of EN_EVENTS) expect(drawn.some((x) => x.trim() === r.parts.at(-1)?.text)).toBe(true)
    })
  }
})
