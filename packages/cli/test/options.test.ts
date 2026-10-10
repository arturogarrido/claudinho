/**
 * The option parsers of the binary, as functions: what `--columns <n>` accepts (a positive integer) and what it
 * refuses (the parser's own error, which commander prints as a wrong option, exit 1, before the command runs).
 */
import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';
import { positiveInteger } from '../src/options';

describe('positiveInteger (`--columns <n>`)', () => {
  it('accepts a positive integer as its number', () => {
    expect(positiveInteger('3')).toBe(3);
    expect(positiveInteger('200')).toBe(200);
  });

  for (const bad of ['abc', '0', '-4', '2.5', '', ' 3', '3 ', '0x10', '1e3']) {
    it(`refuses ${JSON.stringify(bad)} with the parser's own error`, () => {
      expect(() => positiveInteger(bad)).toThrow(InvalidArgumentError);
      expect(() => positiveInteger(bad)).toThrow('a positive integer');
    });
  }
});
