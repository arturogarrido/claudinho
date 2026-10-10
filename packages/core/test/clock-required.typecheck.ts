/**
 * The clock of a now-relative rendering is a REQUIRED parameter: a call that
 * hands none does not compile. Type-checked by `pnpm typecheck` (this folder is
 * in the package's tsconfig), never run by vitest (not a `*.test.ts`): an
 * `@ts-expect-error` whose error disappears (the parameter made optional again)
 * is itself the error.
 */
import { countdown, countdownPhrase } from '../src/time';

export function refused(): void {
  // @ts-expect-error the clock is required: a countdown without one would read the wall clock
  countdown('2026-10-10T11:30:00.000Z');
  // @ts-expect-error the clock is required: a countdown phrase without one would read the wall clock
  countdownPhrase('en', '2026-10-10T11:30:00.000Z');
}
