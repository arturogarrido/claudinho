/**
 * The team look's scenes (plugin 0.9.0), as data: the two drawings `teamScene` chooses besides the band, each an SVG
 * source made from its arguments alone. Pure: no host, no clock, no network, no file, and no import. The hooks module
 * decides which scene is set and when; this module only draws it.
 *
 * - `pitchSvg`: faded pitch lines across the app in the team's main color, and a small scarf hanging at the top right,
 *   in the two colors, with the team's name on it (`scarfName`; no name, no text). It never moves.
 * - `pixelSvg`: a pixel-art stadium corner at the bottom right: three rows of terraces, a scoreboard, a goal and its
 *   net, a patch of pitch. The scoreboard shows the two teams' codes (`boardCode`), drawn as lit squares from a 5x7
 *   glyph table, never as text, and never a score. Its states: `live` (four fans in the team's colors, and a ball by
 *   the goal), `idle` (an empty stadium: no fans and no ball, the board dimmed) and `goal` (the live corner moving once:
 *   after 1.5 s the ball flies into the top corner and back over 4 s, the fans hop, raise their arms, the board blinks
 *   and fireworks burst in the two colors; a reader that asks for reduced motion gets the corner still, the board lit).
 *   A goal's source ends with `<desc>goal N</desc>`, its stamp: the app does not draw a source it already drew again,
 *   so each goal is its own source.
 *
 * Both are drawn for a dark page: on a light one they are faint. A color that is not six hex digits is never written
 * into a drawing: the main color then is pitch green, for both; a second color that is not six hex digits is the main
 * one. What the desktop app's engine does with a scene, measured, is what these drawings avoid: no `shape-rendering`
 * and no `@media` rule but reduced motion (either freezes every animation in it), no script, link, image, `use` or
 * `href`, no animation element, no `url()` but a reference to the drawing's own ids, and well under the engine's limit
 * of 131,072 characters. A scene has no crest, logo or photo: colors, lines and squares.
 */

/** The look of a team with no colors known: pitch green. */
const PITCH_GREEN = '1f7a3d'
const HEX = /^[0-9a-fA-F]{6}$/
/** The scarf's name: at most this many code points. */
const SCARF_MAX = 18
/** A board code: upper-case letters, digits and `&`, at most four; anything else is `NO_CODE`. */
const BOARD_CODE = /^[A-Z0-9&]+$/
const BOARD_MAX = 4
const NO_CODE = '---'

/** The pixel corner's fixed colors, for a dark page. */
const INK = '#f4f6f2'
const STEP = '#22304a'
const EDGE = '#aab7c4'
const FACE = '#05090f'
const LED = '#ffc24a'
const LED_HI = '#fff3c4'
const LEGS = '#3a4c63'
const SKIN = '#c6b99e'
const HAIR = '#111a28'
const SPARK = '#ffe08a'

/** A 5x7 pixel alphabet for the scoreboard: each glyph seven rows of five, `1` lit. */
const FONT: Readonly<Record<string, string>> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01110',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 01110 00000 00000 00000',
  '&': '01100 10010 10100 01000 10101 10010 01101',
}

/** The ball, a pixel sprite, drawn in place (a scene holds no `use`). */
const BALL =
  '<g transform="scale(.55)"><g fill="#e4e5d7" opacity=".83"> <rect x="16" width="48" height="80"/> <rect y="16" width="80" height="48"/> </g> <g fill="#8395a5" opacity=".65"> <rect x="64" y="24" width="16" height="40"/> <rect x="48" y="64" width="16" height="16"/> <rect x="16" y="72" width="32" height="8"/> </g> <g fill="#162233" opacity=".9"> <rect x="24" y="24" width="32" height="24"/> <rect x="32" y="48" width="16" height="8"/> <rect x="16" width="16" height="16"/> <rect x="64" y="16" width="16" height="16"/> <rect y="48" width="16" height="16"/> <rect x="48" y="64" width="16" height="16"/> </g> <rect x="8" y="16" width="16" height="8" fill="#fff8df" opacity=".7"/></g>'

/**
 * The goal's motion: 1.5 s still, then the ball's flight (4 s), the fans' hops (six of half a second), the raised arms,
 * the board's blink and the four rings of each firework one after another; with reduced motion, none of it and the
 * board lit.
 */
const GOAL_CSS =
  '.px-fly{animation:px-shot 4s linear 1.5s 1 both}.px-hop{animation:px-hop .5s ease-in-out 2.0s 6 both}.px-hop2{animation:px-hop .5s ease-in-out 2.25s 6 both}' +
  '.px-arm{animation:px-show 3.5s linear 1.9s 1 both}.px-led{animation:px-led .5s linear 2.0s 6 both}' +
  '.px-r1{animation:px-show .7s linear 2.0s 1 both}.px-r2{animation:px-show .7s linear 2.3s 1 both}.px-r3{animation:px-show .7s linear 2.6s 1 both}.px-r4{animation:px-show .7s linear 2.9s 1 both}' +
  `@media (prefers-reduced-motion:reduce){.px-fly,.px-hop,.px-hop2,.px-arm,.px-led,.px-ring{animation:none!important}.px-led{fill:${LED_HI}}}`
const GOAL_KEYFRAMES = [
  '@keyframes px-shot{0%{transform:translate(0px,0px)}10%{transform:translate(152px,-256px)}88%{transform:translate(152px,-256px)}100%{transform:translate(0px,0px)}}',
  '@keyframes px-hop{0%{transform:translate(0px,0px)}50%{transform:translate(0px,-16px)}100%{transform:translate(0px,0px)}}',
  '@keyframes px-show{0%{opacity:0}8%{opacity:1}85%{opacity:1}100%{opacity:0}}',
  `@keyframes px-led{0%,100%{fill:${LED}}50%{fill:${LED_HI}}}`,
].join('\n')

/** One rectangle. */
const R = (x: number, y: number, w: number, h: number, extra = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"${extra}/>`

/** Text as XML character data: `&`, `<`, `>` and `"` escaped. */
const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The two colors a drawing is made of, `#rrggbb` lower-cased: a usable main color (else pitch green for both), and a usable second one (else the main). */
function colorsOf(main: unknown, second: unknown): { a: string; b: string } {
  if (typeof main !== 'string' || !HEX.test(main)) return { a: `#${PITCH_GREEN}`, b: `#${PITCH_GREEN}` }
  const a = `#${main.toLowerCase()}`
  return { a, b: typeof second === 'string' && HEX.test(second) ? `#${second.toLowerCase()}` : a }
}

/** A color's relative luminance (sRGB), from `#rrggbb`: how bright it reads, 0 to 1. */
function luminance(hex: string): number {
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * f((n >> 16) / 255) + 0.7152 * f(((n >> 8) & 255) / 255) + 0.0722 * f((n & 255) / 255)
}

/**
 * The name the scarf carries: a string with its control characters (U+0000 to U+001F, U+007F to U+009F), lone
 * surrogates and the two noncharacters XML cannot hold (U+FFFE, U+FFFF) removed, trimmed, upper-cased and cut at 18
 * code points; anything else, or nothing left, is ''. Not escaped: the drawing escapes it once.
 */
export function scarfName(name: unknown): string {
  if (typeof name !== 'string') return ''
  const kept = [...name]
    .filter((ch) => {
      const c = ch.codePointAt(0) as number
      return !(c <= 0x1f || (c >= 0x7f && c <= 0x9f) || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff)
    })
    .join('')
  return [...kept.trim().toUpperCase()].slice(0, SCARF_MAX).join('')
}

/**
 * A code as the scoreboard draws it: a string that, upper-cased, is one or more letters `A` to `Z`, digits and `&`,
 * cut at four; anything else is three dashes.
 */
export function boardCode(code: unknown): string {
  if (typeof code !== 'string') return NO_CODE
  const up = code.toUpperCase()
  return BOARD_CODE.test(up) ? up.slice(0, BOARD_MAX) : NO_CODE
}

/**
 * The pitch: faded pitch lines and stripes in the main color across the app (stronger at the two ends, faint in the
 * middle where the conversation is), and at the top right a small scarf in the two colors, its fringe at the bottom,
 * with the team's name along it in one `<text>` (the name escaped; no name, no text).
 */
export function pitchSvg(a: { main: string; second?: string; name?: unknown }): string {
  const { a: A, b: B } = colorsOf(a.main, a.second)
  const bright = luminance(A)
  const stripes = bright > 0.4 ? '0.06' : '0.12'
  const ink = bright < 0.35 ? '#ffffff' : '#10161d'
  const edge = bright > 0.5 ? '#000' : '#fff'
  const name = scarfName(a.name)
  const fringe = Array.from({ length: 10 }, (_, i) => R(4 + i * 10, 0, 7, [32, 40, 36][i % 3] as number, ` fill="${i % 2 === 0 ? B : A}"`)).join('')
  const text =
    name === ''
      ? ''
      : `<text transform="translate(66 330) rotate(-90)" text-anchor="middle" textLength="${Math.min(30 * [...name].length, 400)}" lengthAdjust="spacingAndGlyphs" font-size="36" font-weight="800" letter-spacing="2" fill="${ink}" font-family="system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif">${escapeXml(name)}</text>\n`
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">',
    '<svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">',
    '<defs>',
    '<linearGradient id="cl-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1875" stop-color="#fff" stop-opacity=".45"/><stop offset=".29" stop-color="#fff" stop-opacity=".06"/><stop offset=".775" stop-color="#fff" stop-opacity=".06"/><stop offset=".9" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity=".85"/></linearGradient>',
    '<mask id="cl-m" maskUnits="userSpaceOnUse" x="-200" y="-200" width="2000" height="1400"><rect x="-200" y="-200" width="2000" height="1400" fill="url(#cl-fade)"/></mask>',
    '<pattern id="cl-rib" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="3" fill="#000" fill-opacity=".04"/></pattern>',
    '</defs>',
    '<g mask="url(#cl-m)">',
    `<g fill="${A}" fill-opacity="${stripes}">${R(-134, 30, 242, 940)}${R(350, 30, 242, 940)}${R(834, 30, 242, 940)}${R(1318, 30, 242, 940)}</g>`,
    '<g fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="4" stroke-linejoin="round">',
    '<path d="M-200 30H1560V970H-200"/><path d="M350 30V970"/><circle cx="350" cy="500" r="134"/>',
    '<path d="M1560 204H1317V796H1560"/><path d="M1560 366H1479V634H1560"/><path d="M1317 393A134 134 0 0 0 1317 607"/>',
    '<path d="M1560 446H1596V554H1560"/><path d="M1520 30A40 40 0 0 0 1560 70M1560 930A40 40 0 0 0 1520 970"/></g>',
    '<circle cx="350" cy="500" r="5" fill="#ffffff" fill-opacity="0.4"/><circle cx="1398" cy="500" r="5" fill="#ffffff" fill-opacity="0.4"/>',
    '</g>',
    '</svg>',
    '<svg x="86%" y="0" width="14%" height="34%" viewBox="1366 0 132 340" preserveAspectRatio="xMaxYMin meet"><g transform="translate(1380 -10) rotate(3) scale(.5)">',
    '<path d="M6 0H110V640H6Z" fill="#000" fill-opacity=".16"/>',
    `<rect width="104" height="640" fill="${A}"/><rect width="10" height="640" fill="${B}"/><rect x="94" width="10" height="640" fill="${B}"/>`,
    `<rect y="560" width="104" height="26" fill="${B}"/><rect y="600" width="104" height="10" fill="${B}"/>`,
    `<rect width="104" height="640" fill="url(#cl-rib)"/><rect width="104" height="640" fill="none" stroke="${edge}" stroke-opacity=".18" stroke-width="2"/>`,
    `${text}<g transform="translate(0 640)">${fringe}</g></g></svg>`,
    '</svg>',
  ].join('\n')
}

/** A string drawn in lit squares from `FONT` (each glyph 6 squares apart; a run of lit squares in a row is one rect). */
function glyphs(s: string, x: number, y: number, p: number): string {
  let out = ''
  for (const [i, ch] of [...s].entries()) {
    if (!Object.hasOwn(FONT, ch)) continue
    for (const [r, row] of (FONT[ch] as string).split(' ').entries()) {
      let c = 0
      while (c < 5) {
        if (row[c] === '1') {
          let n = 1
          while (c + n < 5 && row[c + n] === '1') n += 1
          out += R(x + i * 6 * p + c * p, y + r * p, n * p, p)
          c += n
        } else c += 1
      }
    }
  }
  return out
}

/** A fan on the terraces at (x, y), in the team's colors: standing with a scarf held up, or with arms that show at a goal. */
function fan(x: number, y: number, A: string, B: string, stand: boolean, alt: boolean): string {
  const arms = stand
    ? R(-8, -8, 8, 24, ` fill="${SKIN}"`) + R(32, -8, 8, 24, ` fill="${SKIN}"`) + R(-16, -16, 64, 8, ` fill="${A}"`) + R(-16, -16, 8, 8, ` fill="${B}"`) + R(40, -16, 8, 8, ` fill="${B}"`)
    : R(-8, -8, 8, 24, ` class="px-arm" fill="${SKIN}"`) + R(32, -8, 8, 24, ` class="px-arm" fill="${SKIN}"`)
  return (
    `<g transform="translate(${x} ${y})"><g class="${alt ? 'px-hop2' : 'px-hop'}">${arms}` +
    R(8, 0, 16, 16, ` fill="${SKIN}"`) +
    R(8, 0, 16, 8, ` fill="${HAIR}"`) +
    R(0, 16, 32, 32, ` fill="${A}"`) +
    R(12, 16, 8, 32, ` fill="${B}"`) +
    R(4, 48, 8, 16, ` fill="${LEGS}"`) +
    R(20, 48, 8, 16, ` fill="${LEGS}"`) +
    '</g></g>'
  )
}

/** One ring of a firework: eight squares at radius `r` around its center, shown in turn `k` of four. */
function ring(r: number, color: string, k: number): string {
  const at = (d: number): number => Math.floor(Math.trunc(d * r) / 8) * 8
  const d = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ]
    .map(([dx, dy]) => `M${at(dx as number)} ${at(dy as number)}h8v8h-8z`)
    .join('')
  return `<path class="px-ring px-r${k}" fill="${color}" d="${d}"/>`
}

/**
 * The pixel corner in a state: `live`, `idle` or `goal` (anything else is idle). The board shows `home - away`, each
 * by `boardCode`, centered: with neither side usable it is empty, with one the other shows three dashes. `stamp` is a
 * goal's (a positive integer, else 0), written into its `<desc>`; live and idle carry none, and neither moves.
 */
export function pixelSvg(a: {
  main: string
  second?: string
  state: 'live' | 'idle' | 'goal'
  home?: unknown
  away?: unknown
  stamp?: unknown
}): string {
  const { a: A, b: B } = colorsOf(a.main, a.second)
  const state = a.state === 'live' || a.state === 'goal' ? a.state : 'idle'
  const home = boardCode(a.home)
  const away = boardCode(a.away)
  const board = home === NO_CODE && away === NO_CODE ? '' : `${home} - ${away}`
  const boardWidth = board.length * 24 - 4
  const [sx, sy, sw, sh] = [1320, 456, 264, 80]
  const dim = state === 'idle' ? ' opacity=".38"' : ''
  const go = luminance(A) > 0.4 ? ['0.1', '0.040'] : ['0.2', '0.080']
  const terraces = [
    [1248, 760],
    [1296, 664],
    [1344, 568],
  ]
    .map(([x, y]) => R(x as number, y as number, 512, 96, ` fill="${STEP}" opacity=".5"`) + R(x as number, y as number, 512, 8, ` fill="${EDGE}" opacity=".45"`) + R(x as number, (y as number) + 8, 512, 8, ` fill="${B}" opacity=".28"`))
    .join('')
  const scoreboard =
    R(sx + 24, sy + sh, 8, 568 - sy - sh, ` fill="${LEGS}"`) +
    R(sx + sw - 32, sy + sh, 8, 568 - sy - sh, ` fill="${LEGS}"`) +
    R(sx, sy, sw, sh, ` fill="${FACE}"`) +
    `<path d="M${sx} ${sy}h${sw}v${sh}h-${sw}zM${sx + 8} ${sy + 8}v${sh - 16}h${sw - 16}v-${sh - 16}z" fill="${EDGE}" fill-rule="evenodd" opacity=".7"/>` +
    `<g class="px-led" fill="${LED}"${dim}>${glyphs(board, sx + Math.floor((sw - boardWidth) / 2), sy + 26, 4)}</g>`
  const net =
    `<g fill="${INK}" opacity=".26">` +
    Array.from({ length: 9 }, (_, i) => R(1472 + i * 32, 640, 4, 208)).join('') +
    Array.from({ length: 6 }, (_, i) => R(1440, 668 + i * 32, 320, 4)).join('') +
    '</g>'
  const fireworks = (
    [
      [1376, 240, A, SPARK],
      [1512, 312, B, A],
      [1448, 136, SPARK, B],
    ] as Array<[number, number, string, string]>
  )
    .map(([x, y, c1, c2]) => `<g class="px-fx" transform="translate(${x} ${y})">${ring(16, c1, 1)}${ring(32, c2, 2)}${ring(48, c1, 3)}${ring(64, c2, 4)}</g>`)
    .join('')
  const played =
    state === 'idle'
      ? []
      : [
          `<g class="px-crowd">${fan(1280, 696, A, B, true, false)}${fan(1376, 696, A, B, false, true)}${fan(1328, 600, A, B, false, false)}${fan(1408, 600, A, B, false, true)}</g>`,
          R(1296, 940, 40, 6, ' class="px-shadow" fill="#000" opacity=".3"'),
          `<g class="px-ball" transform="translate(1292 896)"><g class="px-fly">${BALL}</g></g>`,
        ]
  const stamp = typeof a.stamp === 'number' && Number.isSafeInteger(a.stamp) && a.stamp > 0 ? a.stamp : 0
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">',
    '<style>',
    '.px-arm,.px-ring{opacity:0}',
    ...(state === 'goal' ? [GOAL_CSS, GOAL_KEYFRAMES] : []),
    '</style>',
    '<svg x="60%" y="0" width="40%" height="100%" viewBox="1232 40 368 960" preserveAspectRatio="xMaxYMax meet">',
    terraces,
    scoreboard,
    `${R(1248, 848, 512, 312, ` fill="${A}" opacity="${go[0]}"`)}${R(1248, 896, 512, 24, ` fill="${B}" opacity="${go[1]}"`)}${R(1248, 848, 512, 8, ` fill="${INK}" opacity=".5"`)}`,
    net,
    `<path d="M1432 632h328v8h-320v208h-8z" fill="${INK}" opacity=".85"/>`,
    ...played,
    fireworks,
    `</svg>${state === 'goal' ? `<desc>goal ${stamp}</desc>` : ''}</svg>`,
  ].join('\n')
}
