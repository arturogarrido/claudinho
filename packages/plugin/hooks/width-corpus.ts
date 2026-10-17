/**
 * The width corpus: strings with the display width core's `displayWidth` (packages/core/src/text.ts) gives each, the
 * rule the CLI aligns its rows with. Two suites read it, so the plugin's copy of the rule cannot drift from core's:
 * core's vitest test (packages/core/test/width-corpus.test.ts) asserts core's `displayWidth` equals every `width`, and
 * the plugin's kit test (hooks/pane-width.test.tsx) asserts the pane measures every `text` the same. A data module, not
 * JSON: the kit loads only files named like code. Every invisible or non-ASCII character is written as an escape.
 */
export type WidthCase = { readonly what: string; readonly text: string; readonly width: number }

export const WIDTH_CORPUS: readonly WidthCase[] = [
  { what: 'plain ASCII', text: 'Arsenal', width: 7 },
  { what: 'the goal marker', text: '⚽', width: 2 },
  { what: 'the yellow card marker', text: '\u{1F7E8}', width: 2 },
  { what: 'the red card marker', text: '\u{1F7E5}', width: 2 },
  { what: 'the substitution marker', text: '\u{1F504}', width: 2 },
  { what: 'a regional-indicator flag and a code', text: '\u{1F1F2}\u{1F1FD} MEX', width: 6 },
  { what: "England's tag-sequence flag and a code", text: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} ENG', width: 6 },
  { what: 'a text symbol made emoji by U+FE0F, then a word', text: '⚠️ Aviso', width: 8 },
  { what: 'a heart with U+FE0F', text: '❤️', width: 2 },
  { what: 'a pictograph without U+FE0F', text: '☺', width: 2 },
  { what: 'the copyright sign and a word', text: '© ESPN', width: 7 },
  { what: 'a word and the trade mark sign', text: 'Liga™', width: 6 },
  { what: 'a ZWJ family', text: '\u{1F468}‍\u{1F469}‍\u{1F467}', width: 2 },
  { what: 'a keycap', text: '1️⃣', width: 2 },
  { what: 'a combining acute accent', text: 'José', width: 4 },
  { what: 'precomposed accents', text: 'Víctor Muñoz', width: 12 },
  { what: 'a CJK name (Han)', text: '孫興民', width: 6 },
  { what: 'a CJK name (katakana, a middle dot)', text: 'ソン・フンミン', width: 14 },
  { what: 'a Hangul name', text: '손흥민', width: 6 },
  { what: 'a CJK venue with digits', text: '埼玉スタジアム2002', width: 18 },
  { what: 'fullwidth Latin letters', text: 'ＦＣ', width: 4 },
  { what: 'a zero-width space between two letters', text: 'A​B', width: 2 },
]
