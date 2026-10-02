export type CanaryVerdict = 'ok' | 'rejected' | 'changed' | 'blocked' | 'unreachable';
export interface CanaryRow {
  competition: string;
  request: 'live' | 'day' | 'window' | 'knockout' | 'standings';
  /** The first request the question took. */
  url: string;
  /** How many requests it took. */
  requests: number;
  verdict: CanaryVerdict;
  detail: string;
}
export interface CanaryResult {
  rows: CanaryRow[];
  red: boolean;
}
export const CANARY_COMPETITIONS: readonly string[];
export const STANDING_STATS: readonly string[];
export const CANARY_TABLES: { readonly read: readonly string[]; readonly none: readonly string[] };
export const CANARY_QUESTIONS: readonly { request: CanaryRow['request']; method: string; bundleOnly?: boolean }[];
export function canaryWarnings(result: CanaryResult): string[];
export function adapterTablesProblem(account: {
  complete: boolean | undefined;
  tables: readonly { group: string; partial?: unknown }[];
  expected?: readonly string[];
  sent: number;
}): string | undefined;
export function runCanary(options: {
  core: unknown;
  competitions?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: Date;
  pauseMs?: number;
  bodyDeadlineMs?: number;
}): Promise<CanaryResult>;
export function formatCanary(result: CanaryResult): string;
