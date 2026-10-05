export function competitionLabel(env: string | undefined): string;
export function resolvedSlug(jsonText: string): string | undefined;
export function driftGate(
  slug: string | undefined,
  bundle: string,
): { kind: 'run' } | { kind: 'skip' | 'fail'; detail: string };
export function driftVerdict(output: string | undefined): { kind: 'ok' | 'fail' | 'skip' | 'broken'; detail: string };
export const CLUB: { alias: string; slug: string; team: string };
export function clubPass(headerJson: string): { kind: 'run' } | { kind: 'skip'; detail: string };
export function clubHeader(followJson: string): string;
export function clubFollowed(followJson: string): { kind: 'ok' } | { kind: 'fail'; detail: string };
export function clubCardVerdict(shareJson: string): { kind: 'ok' | 'between' | 'outage' | 'broken'; detail: string };
export function cardCarriesDisclaimer(shareJson: string, disclaimer: string): boolean;
export function ptTableVerdict(text: string): { kind: 'ok' | 'skip' | 'fail' | 'broken'; detail: string };
export function promptVerdict(
  output: string,
  spawns: string,
  seeded: string,
): { kind: 'ok' | 'fail' | 'broken'; detail: string };
