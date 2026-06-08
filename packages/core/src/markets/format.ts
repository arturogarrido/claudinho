/**
 * Provider-neutral text snippets for market signals — the single home for the
 * approved copy bank, shared verbatim by CLI and MCP. Keeping copy here (not in
 * each client) is a legal control: the language stays factual and never says
 * "bet", "value", "edge", "lock", etc. Display precision is whole-number
 * percent on purpose, to avoid implying false precision.
 */
import type { Match } from '../types';
import type { MarketOutcome, MarketOutcomeKind, MarketSignal } from './types';

/** Whole-number percentage. */
function pct(p: number): number {
  return Math.round(p * 100);
}

/** Human label for the data source (text only — never a logo). */
export function marketSourceLabel(source: string): string {
  if (source === 'polymarket') return 'Polymarket';
  if (source === 'fake') return 'demo data';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function outcomeLabel(o: MarketOutcome, match: Match): string {
  if (o.kind === 'home') return match.home.name;
  if (o.kind === 'away') return match.away.name;
  if (o.kind === 'draw') return 'Draw';
  return o.label;
}

/** "HH:MM UTC" from an ISO timestamp; empty string when unparseable. */
function utcHhmm(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return `${new Date(t).toISOString().slice(11, 16)} UTC`;
}

/** One-line favorite read, drawn only from the approved copy bank. */
export function marketFavoriteText(signal: MarketSignal, match: Match): string {
  const fav = signal.favorite;
  if (!fav || fav.strength === 'close') return 'Prediction markets see this match as close.';
  if (fav.kind === 'draw') return 'Prediction markets see a draw as the top outcome.';
  const name = fav.kind === 'home' ? match.home.name : match.away.name;
  return fav.strength === 'clear'
    ? `Prediction markets favor ${name}.`
    : `Prediction markets slightly favor ${name}.`;
}

/** "Mexico 56% · Draw 25% · South Africa 19%" in home·draw·away reading order. */
export function marketProbabilityText(signal: MarketSignal, match: Match): string {
  const order: MarketOutcomeKind[] = ['home', 'draw', 'away'];
  const parts: string[] = [];
  for (const kind of order) {
    const o = signal.outcomes.find((x) => x.kind === kind);
    if (o) parts.push(`${outcomeLabel(o, match)} ${pct(o.probability)}%`);
  }
  for (const o of signal.outcomes) {
    if (o.kind === 'other') parts.push(`${outcomeLabel(o, match)} ${pct(o.probability)}%`);
  }
  return parts.join(' · ');
}

/** "Source: Polymarket · updated 14:32 UTC". */
export function marketAttributionText(signal: MarketSignal): string {
  const time = utcHhmm(signal.asOf);
  const src = `Source: ${marketSourceLabel(signal.source)}`;
  return time ? `${src} · updated ${time}` : src;
}

/** Compact one-liner for an inline annotation under a match row. */
export function marketLine(signal: MarketSignal, match: Match): string {
  return `Market: ${marketProbabilityText(signal, match)} · ${marketSourceLabel(
    signal.source,
  )} · informational only`;
}

/**
 * Multi-line detail block (the caller indents/colorizes). Used by `match <id>`
 * and the dedicated `markets` command. Always carries attribution and the
 * informational-only caveat; prepends a stale warning when applicable.
 */
export function marketBlock(signal: MarketSignal, match: Match): string[] {
  const lines: string[] = [];
  if (signal.stale) lines.push('Market signal is stale; the reading may be out of date.');
  lines.push(marketFavoriteText(signal, match));
  lines.push(marketProbabilityText(signal, match));
  lines.push(`${marketAttributionText(signal)} · informational only`);
  return lines;
}
