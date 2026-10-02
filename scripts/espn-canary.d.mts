export type CanaryVerdict = 'ok' | 'rejected' | 'changed' | 'blocked' | 'unreachable';
export interface CanaryRow {
  competition: string;
  request: 'live' | 'day' | 'window' | 'standings';
  url: string;
  verdict: CanaryVerdict;
  detail: string;
}
export interface CanaryResult {
  rows: CanaryRow[];
  red: boolean;
}
export const CANARY_COMPETITIONS: readonly string[];
export function runCanary(options: {
  core: unknown;
  competitions?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: Date;
  pauseMs?: number;
}): Promise<CanaryResult>;
export function formatCanary(result: CanaryResult): string;
