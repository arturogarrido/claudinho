export function competitionLabel(env: string | undefined): string;
export function resolvedSlug(jsonText: string): string | undefined;
export function driftGate(
  slug: string | undefined,
  bundle: string,
): { kind: 'run' } | { kind: 'skip' | 'fail'; detail: string };
export function driftVerdict(output: string | undefined): { kind: 'ok' | 'fail' | 'skip' | 'broken'; detail: string };
