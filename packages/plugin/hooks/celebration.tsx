import type { BoxProps, ElementConstructor, RenderChildren, RenderElement, RenderSurface, SvgProps, TextProps } from 'claude-code'

/**
 * The goal and full-time celebration's drawing: Anthropic's Claude mascot (in these two celebrations only) at the left
 * of the celebration's three rows, the ball that crosses the top row, the goal's middle row and full time's, and the
 * celebration's lengths. Pure: each function is handed the surface's elements (the table the caller's render hook
 * resolved) and the rows' values, and draws; it reads no host, no state and no clock. The plugin's hooks module draws
 * the band's celebration with these functions and plays it for these lengths, and the plugin's demo
 * (`packages/plugin-demo`, assembled by `scripts/plugin-demo.sh`) plays it with the same ones, so what the demo shows in
 * the app is what the plugin draws.
 */

/** A celebration frame's length, in milliseconds: the mascot's legs step, and the ball moves, once a frame. */
export const FRAME_MS = 500
/** A goal's frames, its whole length (3 s): the ball crosses the top row in them. */
export const GOAL_FRAMES = 6
/** Full time's length on screen, in milliseconds (the pinned side's win or draw). */
export const FULLTIME_MS = 5_000
/** The ball's display width (an emoji takes two columns). */
const BALL_COLUMNS = 2
/**
 * Anthropic's Claude mascot, in the goal and full-time celebrations only, left of the celebration's three rows. These
 * three rows of text art (its head, its body, its legs in two steps) are its one shape: the terminal draws them as
 * text in the theme's `claude` colour; the desktop app, whose proportional face pulls text art apart (a space narrower
 * than a block glyph, a line taller than one), draws the same rows as one `Svg` of rectangles (`mascotSvg`).
 */
const MASCOT_HEAD = ' ▐▛███▜▌'
const MASCOT_BODY = '▝▜█████▛▘'
const MASCOT_LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const
/** The mascot's widest row, and the column between it and the celebration's text. */
const MASCOT_COLUMNS = 9
const MASCOT_GAP = 1
/** The theme keys the moments are drawn in: the mascot's, and the goal word's (the hooks module's pane accent too). */
const MASCOT_COLOR = 'claude'
const GOAL_COLOR = 'success'
/** One quadrant of a glyph in the desktop drawing, in CSS pixels: a glyph is two quadrants across and two down. */
const MASCOT_QUAD_WIDTH = 4
const MASCOT_QUAD_HEIGHT = 9
/** An image cannot read the theme's `claude` key, so the desktop drawing uses one fixed colour. */
const MASCOT_SVG_COLOR = '#D97757'
const MASCOT_ALT = 'Claude mascot'
/** The quadrants each glyph of the rows lights: upper left, upper right, lower left, lower right. */
const MASCOT_QUADRANTS: Readonly<Record<string, readonly [boolean, boolean, boolean, boolean]>> = {
  ' ': [false, false, false, false],
  '█': [true, true, true, true],
  '▐': [false, true, false, true],
  '▌': [true, false, true, false],
  '▛': [true, true, true, false],
  '▜': [true, true, false, true],
  '▝': [false, true, false, false],
  '▘': [true, false, false, false],
}

/**
 * The mascot's three rows, its legs at `step`, as an `Svg` source for the desktop app: one rectangle per lit quadrant
 * (a glyph not listed lights none), none merged, in the one fixed colour; nine columns by three rows, 72 by 54.
 */
const mascotSvg = (step: number): string => {
  const rows: readonly string[] = [MASCOT_HEAD, MASCOT_BODY, MASCOT_LEGS[step % 2] ?? '']
  const rects: string[] = []
  rows.forEach((row, r) => {
    Array.from(row).forEach((glyph, c) => {
      const lit = Object.hasOwn(MASCOT_QUADRANTS, glyph) ? MASCOT_QUADRANTS[glyph] : undefined
      lit?.forEach((on, q) => {
        if (!on) return
        const x = (c * 2 + (q % 2)) * MASCOT_QUAD_WIDTH
        const y = (r * 2 + Math.floor(q / 2)) * MASCOT_QUAD_HEIGHT
        rects.push(`<rect x="${x}" y="${y}" width="${MASCOT_QUAD_WIDTH}" height="${MASCOT_QUAD_HEIGHT}"/>`)
      })
    })
  })
  const width = MASCOT_COLUMNS * 2 * MASCOT_QUAD_WIDTH
  const height = rows.length * 2 * MASCOT_QUAD_HEIGHT
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"` +
    ` shape-rendering="crispEdges" fill="${MASCOT_SVG_COLOR}">${rects.join('')}</svg>`
  )
}

/**
 * The surface's elements a celebration is drawn with, from the table the caller's render hook resolved: `Box` and
 * `Text`, which every surface has, and the desktop app's `Svg`.
 */
export type CelebrationElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Svg?: ElementConstructor<SvgProps>
}

/** The three rows beside the mascot: the top and the bottom as text, the middle as the caller drew it (`goalRow`, or full time's `resultRow`). */
export type CelebrationRows = { top: string; middle: RenderChildren; bottom: string }

/**
 * The celebration's row: the mascot's column, its legs at `step` (in the desktop app the three rows as one `Svg`, since
 * text art comes apart in its proportional face; on every other surface three Texts in the theme's `claude` colour),
 * then the column of the three rows, one column apart from it.
 */
export const celebrationRow = (elements: CelebrationElements, surface: RenderSurface, step: number, rows: CelebrationRows): RenderElement => {
  const { Box, Text, Svg } = elements
  const mascot =
    surface === 'desktop' && Svg !== undefined ? (
      <Box flexDirection="column">
        <Svg source={mascotSvg(step)} alt={MASCOT_ALT} />
      </Box>
    ) : (
      <Box flexDirection="column">
        <Text color={MASCOT_COLOR}>{MASCOT_HEAD}</Text>
        <Text color={MASCOT_COLOR}>{MASCOT_BODY}</Text>
        <Text color={MASCOT_COLOR}>{MASCOT_LEGS[step % 2]}</Text>
      </Box>
    )
  return (
    <Box key="mascot">
      {mascot}
      <Box flexDirection="column" paddingLeft={MASCOT_GAP}>
        <Text wrap="truncate-end">{rows.top}</Text>
        {rows.middle}
        <Text wrap="truncate-end">{rows.bottom}</Text>
      </Box>
    </Box>
  )
}

/**
 * A goal's top row at `frame` (0 to 5): the ball stepping right across the row's columns, never past them. The row is
 * the band's `columns` less the `left` columns beside it (by default the mascot's and its gap; the older banner, drawn
 * with no mascot, passes 0).
 */
export const celebrationBall = (frame: number, columns: number, left: number = MASCOT_COLUMNS + MASCOT_GAP): string => {
  const room = Math.max(0, Math.max(0, columns - left) - BALL_COLUMNS)
  return `${' '.repeat(Math.floor((frame * room) / (GOAL_FRAMES - 1)))}⚽`
}

/**
 * A goal's middle row: the goal word (whole on every frame; bold, in the theme's `success` colour), then the team.
 * `key` is the row's place in the band: `row-1` beside the mascot, `row-0` when the goal has one row (the caller then
 * hands the team with its minute).
 */
export const goalRow = (elements: Pick<CelebrationElements, 'Text'>, word: string, team: string, key = 'row-1'): RenderElement => {
  const { Text } = elements
  return (
    <Text key={key} wrap="truncate-end">
      <Text key="goal-word" bold color={GOAL_COLOR}>
        {word}
      </Text>
      {` ${team}`}
    </Text>
  )
}

/**
 * Full time's middle row: its words (`<heading> · <result>`, as the caller wrote them), plain. `key` is the row's place
 * in the band, `row-1` (the middle row beside the mascot) by default.
 */
export const resultRow = (elements: Pick<CelebrationElements, 'Text'>, text: string, key = 'row-1'): RenderElement => {
  const { Text } = elements
  return (
    <Text key={key} wrap="truncate-end">
      {text}
    </Text>
  )
}
