import { InvalidArgumentError } from 'commander';

/**
 * `--columns <n>`'s argument parser: a positive integer, and anything else is
 * refused by the option parser as every wrong option is (its message and
 * exit, before the command runs; nothing on stdout).
 */
export function positiveInteger(value: string): number {
  const n = /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
  if (!(n > 0)) throw new InvalidArgumentError('a positive integer');
  return n;
}
