import type { ThemeSetArgs } from 'claude-code'
import { makeColors } from './make-colors.js'
import { FLAG_COLORS, NATION_IDS, TEAM_COLORS } from './team-colors'

/**
 * The team look (plugin 0.8.0), as data: which colors a pick has (and, plugin 0.10.0, which flag a national team has,
 * `flagForPick`, for the stadium's scarf), and the look made from them. Pure: no host, no
 * network, no file. The hooks module decides when a look is set; this module only builds it.
 *
 * A look is the argument of the engine's theme set: `colors`, the whole theme `makeColors` builds for both modes from the
 * team's main color (the accent) and its second one (the `pro` role), its grays tinted toward the main color's hue
 * (toward the second's, and barely, when the main color is a near-gray); and `backdrop`, a scene named for the team's
 * two colors (`band-<main>-<second>`, the main color twice for a team with one), with the app's frosted glass over it.
 * The hooks module draws that scene (`bandSvg`): a band across the top of the app, the main color on its left half and
 * the second on its right, each a band color (`bandColor`: the team's own value, a dark one lifted, a near-gray shown as
 * a light or mid gray), fading out downward. The band's colors are raw values: they do not follow light and dark.
 * Plain colors and plain gradients of them only: no image file, no crest, kit or logo. A team with no colors known, or
 * colors that are not six hex digits, gets pitch green.
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
/** The frosted glass the app lays over the band. */
const GLASS = { blur: 28, opacity: 0.5 } as const
/** A band scene's name: `band-`, then the main color and the second, six lowercase hex digits each. */
const BAND_SCENE = /^band-([0-9a-f]{6})-([0-9a-f]{6})$/
const BAND_SCENE_LENGTH = 'band-'.length + 6 + 1 + 6
/** A band color: a near-gray lighter than this is shown as the light gray, else as the mid gray. */
const LIGHT_GRAY_ABOVE = 0.7
const LIGHT_GRAY = '#f2f4f7'
const MID_GRAY = '#8a8f98'
/**
 * A band color: a color darker than this HSL lightness is lifted to `LIFTED_LIGHTNESS` at its own hue and saturation, so
 * it reads on a dark page; one at or above it is the team's own (Barcelona's garnet, `a50044`, at 0.324, stays as it is).
 */
const DARK_BELOW = 0.32
const LIFTED_LIGHTNESS = 0.4

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

/** A national team's flag colors (`FLAG_COLORS`): two or three, six hex digits each, in the flag's order. */
export type FlagColors = readonly [string, string, string?]

/**
 * The flag of a pick in a competition, by the same rule as `colorsForPick`, own properties alone: a pick whose `id` is
 * a string, that id's flag, or none (an id present decides, known or not: a club has none); a pick with no `id` key
 * under the World Cup, the flag of the nation of its `code`, exact case. Anything else: none.
 */
export function flagForPick(pick: unknown, slug: unknown): FlagColors | undefined {
  if (!isRecord(pick)) return undefined
  if (Object.hasOwn(pick, 'id')) {
    const id = pick.id
    return typeof id === 'string' && Object.hasOwn(FLAG_COLORS, id) ? FLAG_COLORS[id] : undefined
  }
  if (slug !== WORLD_CUP) return undefined
  const code = pick.code
  if (typeof code !== 'string' || !Object.hasOwn(NATION_IDS, code)) return undefined
  const id = NATION_IDS[code]
  return typeof id === 'string' && Object.hasOwn(FLAG_COLORS, id) ? FLAG_COLORS[id] : undefined
}

/** A color's hue (degrees), HSL saturation and HSL lightness. */
function hslOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex, 16)
  const r = (n >> 16) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
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
  const [ph, ps] = hslOf(main)
  const neutral = ps < NEUTRAL_SATURATION
  const h = neutral && second !== undefined ? hslOf(second)[0] : ph
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
 * A look of these colors: the theme, and the band's scene, named for the team's main color and its second one (the main
 * color again for a team with one), six lowercase hex digits each, so a new pair is a new name and the app draws the
 * band again; the app's frosted glass over it.
 */
function lookOf(colors: ThemeSetArgs['colors'], main: string, second: string | undefined): ThemeSetArgs {
  return {
    colors,
    backdrop: { scene: `band-${main}-${second ?? main}`, glass: { ...GLASS } },
  }
}

/** Pitch green's look: a constant definition, so it builds the same every time. */
function pitch(): { look: ThemeSetArgs; problems: string[] } {
  const { theme, problems } = makeColors(definition(PITCH_LABEL, PITCH_GREEN, undefined))
  return { look: lookOf(theme, PITCH_GREEN, undefined), problems }
}

/**
 * The look for a team: its colors (usable ones, else pitch green) and the band's scene; the label `Claudinho: <name>`
 * for a team's colors and a name, else `Claudinho: pitch`. `problems` are what `makeColors` says of the colors (a line
 * starting "Desktop won't paint" is one the desktop app would refuse). A build that throws falls back to pitch green.
 * The band shows the main color on the left and the second on the right whatever they are, a near-gray main color
 * included (the theme's roles are another matter: `definition`).
 */
export function buildLook(
  name: string | undefined,
  colors: TeamColors | undefined,
): { look: ThemeSetArgs; problems: string[] } {
  const team = usable(colors)
  if (team === undefined) return pitch()
  const label = typeof name === 'string' && name !== '' ? labelOf(name) : PITCH_LABEL
  try {
    const { theme, problems } = makeColors(definition(label, team[0], team[1]))
    return { look: lookOf(theme, team[0], team[1]), problems }
  } catch {
    return pitch()
  }
}

/**
 * A band color, `#rrggbb`, from a team color of six hex digits (no `#`), by its HSL: a near-gray (saturation below 0.12)
 * is the light gray when its lightness is above 0.7, else the mid gray (it has no hue to lift); a color darker than
 * `DARK_BELOW` is lifted to a lightness of 0.4 at its own hue and saturation, so it reads on a dark page; any other is
 * the team's own value, lower-cased.
 */
export function bandColor(hex: string): string {
  const [h, s, l] = hslOf(hex)
  if (s < NEUTRAL_SATURATION) return l > LIGHT_GRAY_ABOVE ? LIGHT_GRAY : MID_GRAY
  if (l < DARK_BELOW) return hslHex(h, s, LIFTED_LIGHTNESS)
  return `#${hex.toLowerCase()}`
}

/**
 * The band's drawing for a scene name, or none: a name that is exactly `band-<main>-<second>` (six lowercase hex digits
 * each, nothing before or after) is an SVG of a band across the top, the main color's band color on the left half and
 * the second's on the right, fading out by a third of the height; anything else (another name, another plugin's shape,
 * a value that is no string) is none. The drawing is made from the two colors alone: no text of the name is copied into
 * it, and it holds no script, no link and nothing that loads.
 */
export function bandSvg(scene: unknown): string | undefined {
  if (typeof scene !== 'string' || scene.length !== BAND_SCENE_LENGTH) return undefined
  const m = BAND_SCENE.exec(scene)
  if (m === null) return undefined
  const a = bandColor(m[1] as string)
  const b = bandColor(m[2] as string)
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><defs>' +
    `<linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    '<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".12" stop-color="#fff" stop-opacity=".45"/><stop offset=".32" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<mask id="m"><rect width="1600" height="1000" fill="url(#f)"/></mask></defs>' +
    '<rect width="1600" height="1000" fill="url(#t)" mask="url(#m)"/></svg>'
  )
}
