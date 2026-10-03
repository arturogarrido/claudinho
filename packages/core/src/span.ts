/**
 * Discovery's span, in the provider's calendar days around the day asked. Its
 * own module because the read (`live.ts`) and the sentences that name it
 * (`verdict.ts`: "no team called X in the table or in its fixtures over the
 * next 14 days") both need the number, and the verdict module is below the
 * read.
 */

/** Discovery looks this many provider days back (a match that kicked off late yesterday can still be in play). */
export const SCHEDULE_LOOKBACK_DAYS = 1;
/** And this many ahead. */
export const SCHEDULE_AHEAD_DAYS = 14;
