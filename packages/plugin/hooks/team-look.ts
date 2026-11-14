import type { ThemeSetArgs } from 'claude-code'
import { makeColors } from './make-colors.js'
import { NATION_IDS, TEAM_COLORS } from './team-colors'

/**
 * The team look (plugin 0.8.0), as data: which colors a pick has, and the look made from them. Pure: no host, no
 * network, no file. The hooks module decides when a look is set; this module only builds it.
 *
 * A look is the argument of the engine's theme set: `colors`, the whole theme `makeColors` builds for both modes from the
 * team's main color (the accent) and its second one (the `pro` role), its grays tinted toward the main color's hue
 * (toward the second's, and barely, when the main color is a near-gray); and `backdrop`, a still gradient of two palette
 * names (`bg-accent` at the left edge, `surface-0` between, and at the right edge `bg-pro` for a team with a second
 * color, else `bg-accent`), so it follows light and dark. Plain colors only: no scene, no
 * image, no crest, kit or logo. A team with no colors known, or colors that are not six hex digits, gets pitch green.
 */

/** A team's colors: a main one and, for some, a second one, six hex digits each (no `#`). */
export type TeamColors = readonly [string, string?]

/** The look of a team with no colors known. */
const PITCH_GREEN = '1f7a3d'
const HEX = /^[0-9a-fA-F]{6}$/
/** The engine's limit on a theme's label (the name a picker shows). */
const LABEL_MAX = 64
const LABEL_PREFIX = 'Claudinho: '
const PITCH_LABEL = `${LABEL_PREFIX}pitch`
/** The competition whose pins carry no id: the World Cup's nations are matched by their code. */
const WORLD_CUP = 'fifa.world'
/** Below this HSL saturation the main color is a near-gray (white, black, silver), and tints nothing. */
const NEUTRAL_SATURATION = 0.12

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The colors of a pick (the view's `pick`) in a competition (the view's `competition.slug`), by own properties alone.
 * A pick whose `id` is a string: that id's colors, or none (an id present decides, known or not). A pick with no `id`
 * key under the World Cup: the nation of its `code`, exact case. Anything else: none.
 */
export function colorsForPick(pick: unknown, slug: unknown): TeamColors | undefined {
  if (!isRecord(pick)) return undefined
  if (Object.hasOwn(pick, 'id')) {
    const id = pick.id
    return typeof id === 'string' && Object.hasOwn(TEAM_COLORS, id) ? TEAM_COLORS[id] : undefined
  }
  if (slug !== WORLD_CUP) return undefined
  const code = pick.code
  if (typeof code !== 'string' || !Object.hasOwn(NATION_IDS, code)) return undefined
  const id = NATION_IDS[code]
  return typeof id === 'string' && Object.hasOwn(TEAM_COLORS, id) ? TEAM_COLORS[id] : undefined
}

/** A color's hue (degrees) and HSL saturation. */
function hueAndSaturation(hex: string): [number, number] {
  const n = Number.parseInt(hex, 16)
  const r = (n >> 16) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s]
}

/** `hsl(h, s, l)` as `#rrggbb`. */
function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** The colors when they are usable: an array whose first entry, and second when present, are six hex digits. */
function usable(colors: unknown): [string, string | undefined] | undefined {
  if (!Array.isArray(colors)) return undefined
  const [main, second] = colors as unknown[]
  if (typeof main !== 'string' || !HEX.test(main)) return undefined
  if (second !== undefined && (typeof second !== 'string' || !HEX.test(second))) return undefined
  return [main.toLowerCase(), second?.toLowerCase()]
}

/** A label of at most 64 UTF-16 units, never ending in half a surrogate pair. */
function labelOf(name: string): string {
  const full = `${LABEL_PREFIX}${name}`
  if (full.length <= LABEL_MAX) return full
  const cut = full.slice(0, LABEL_MAX)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * The definition `makeColors` takes for a main color and a second one. With `[ph, ps]` the main color's hue and
 * saturation: a near-gray main color (`ps < 0.12`) takes its hue from the second color when there is one, and its grays
 * are barely tinted (`k = 0.12`); its accent is then the second color. The anchors are fixed lightnesses at the hue
 * (measured: every table entry and pitch green pass the desktop app's contrast check with them).
 */
function definition(label: string, main: string, second: string | undefined) {
  const [ph, ps] = hueAndSaturation(main)
  const neutral = ps < NEUTRAL_SATURATION
  const h = neutral && second !== undefined ? hueAndSaturation(second)[0] : ph
  const k = neutral ? 0.12 : 1
  return {
    label,
    roles: {
      accent: `#${neutral && second !== undefined ? second : main}`,
      ...(second !== undefined && !neutral ? { pro: `#${second}` } : {}),
    },
    light: {
      gray: {
        anchors: {
          'surface-0': hslHex(h, 0.22 * k, 0.93),
          'surface-1': hslHex(h, 0.22 * k, 0.955),
          'surface-2': hslHex(h, 0.22 * k, 0.975),
          'text-primary': hslHex(h, 0.25 * k, 0.12),
          'text-secondary': hslHex(h, 0.15 * k, 0.27),
          'text-muted': hslHex(h, 0.1 * k, 0.38),
        },
      },
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': hslHex(h, 0.28 * k, 0.085),
          'surface-1': hslHex(h, 0.26 * k, 0.115),
          'surface-2': hslHex(h, 0.24 * k, 0.145),
          'surface-3': hslHex(h, 0.22 * k, 0.17),
          'text-primary': hslHex(h, 0.2 * k, 0.93),
          'text-secondary': hslHex(h, 0.14 * k, 0.78),
          'text-muted': hslHex(h, 0.1 * k, 0.64),
        },
      },
    },
  }
}

/**
 * A look of these colors: the theme, and the still wash (the accent's background at the left edge, the page between,
 * and at the right edge the second color's background when the theme has one as its `pro` role, else the accent's
 * again), whose stops are palette names, so it follows light and dark.
 */
function lookOf(colors: ThemeSetArgs['colors'], hasSecond: boolean): ThemeSetArgs {
  return {
    colors,
    backdrop: {
      gradient: {
        angle: 90,
        stops: [
          { at: 0, color: 'bg-accent' },
          { at: 0.16, color: 'surface-0' },
          { at: 0.84, color: 'surface-0' },
          { at: 1, color: hasSecond ? 'bg-pro' : 'bg-accent' },
        ],
      },
    },
  }
}

/** Pitch green's look: a constant definition, so it builds the same every time. */
function pitch(): { look: ThemeSetArgs; problems: string[] } {
  const { theme, problems } = makeColors(definition(PITCH_LABEL, PITCH_GREEN, undefined))
  return { look: lookOf(theme, false), problems }
}

/**
 * The look for a team: its colors (usable ones, else pitch green) and the still wash; the label `Claudinho: <name>`
 * for a team's colors and a name, else `Claudinho: pitch`. `problems` are what `makeColors` says of the colors (a line
 * starting "Desktop won't paint" is one the desktop app would refuse). A build that throws falls back to pitch green.
 */
export function buildLook(
  name: string | undefined,
  colors: TeamColors | undefined,
): { look: ThemeSetArgs; problems: string[] } {
  const team = usable(colors)
  if (team === undefined) return pitch()
  const label = typeof name === 'string' && name !== '' ? labelOf(name) : PITCH_LABEL
  try {
    const made = definition(label, team[0], team[1])
    const { theme, problems } = makeColors(made)
    return { look: lookOf(theme, Object.hasOwn(made.roles, 'pro')), problems }
  } catch {
    return pitch()
  }
}
