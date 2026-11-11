import { displayWidth } from '@claudinho/core';

/** The width a text is wrapped at when the stream states none (not a terminal). */
export const DEFAULT_WIDTH = 80;

/**
 * Words of `text` in lines of at most `width` display columns, broken at
 * whitespace only, so a word (an alias, `premier-league,`) is never split; a
 * word wider than `width` stands on its own line. Every run of whitespace,
 * a line break included, is one break opportunity: one paragraph in, its
 * lines out.
 */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && displayWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A message of several lines, each wrapped on its own (its line breaks kept),
 * to a stream's width: `columns` when the stream states one, else
 * {@link DEFAULT_WIDTH}; `indent` is put before every line and counted in the
 * width. The lines, without a final line break.
 */
export function wrapLines(text: string, columns: number | undefined, indent = ''): string[] {
  const width = Math.max(20, (columns !== undefined && columns > 0 ? columns : DEFAULT_WIDTH) - displayWidth(indent));
  return text.split('\n').flatMap((line) => {
    const wrapped = wrap(line, width);
    return (wrapped.length > 0 ? wrapped : ['']).map((l) => `${indent}${l}`);
  });
}
