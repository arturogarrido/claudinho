/**
 * Share cards for clubs (0.11 · 2.2 + 2.4): nothing in the flag's place, no
 * double space, no placeholder; the stage line says the written stage
 * ("League", "Play-offs") or the provider's own words for an unknown one, and
 * nothing at all when an OTHER carries no words.
 */
import { describe, expect, it } from 'vitest';
import { formatShareSnippet, formatShareTable } from '../src';
import type { Match, StandingRow } from '../src/types';

const club = (over: Partial<Match> = {}): Match => ({
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-04T14:00:00.000Z',
  venue: 'Emirates Stadium',
  city: 'London',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'LIVE',
  minute: 50,
  score: { home: 2, away: 1 },
  updatedAt: '2026-10-04T14:50:00.000Z',
  ...over,
});

const input = (matches: Match[]) => ({
  title: 'Live now',
  matches,
  installLine: 'CLAUDINHO_COMPETITION=eng.1 npx @claudinho/cli live',
  tz: 'UTC',
  locale: 'en',
});

const DOUBLE_SPACE = /\S {2}\S/;

describe('a club card: nothing in the flag\'s place', () => {
  it('social: the names stand alone, with no leading or trailing gap', () => {
    const out = formatShareSnippet(input([club()]), { style: 'social' });
    expect(out).toContain('Arsenal 2–1 Chelsea · 50\'');
    expect(out).not.toContain('🏳️');
    expect(out).not.toContain('undefined');
    expect(out).not.toMatch(DOUBLE_SPACE);
    expect(out).toContain('League');
    expect(out).not.toContain('Friendly');
  });

  it('compact: the codes stand alone', () => {
    const out = formatShareSnippet(input([club()]), { style: 'compact' });
    expect(out).toContain('ARS 2–1 CHE');
    expect(out).not.toContain('🏳️');
    expect(out).not.toContain('undefined');
    expect(out).not.toMatch(DOUBLE_SPACE);
  });

  it('a nation card is as it was: the flag on each side', () => {
    const nation = club({
      home: { code: 'ALB', name: 'Albania', flag: '🇦🇱', id: 'espn:2654' },
      away: { code: 'LVA', name: 'Latvia', flag: '🇱🇻', id: 'espn:2578' },
      stage: 'LEAGUE',
    });
    const out = formatShareSnippet(input([nation]), { style: 'social' });
    expect(out).toContain('🇦🇱 Albania 2–1 Latvia 🇱🇻 · 50\'');
    expect(out).toContain('League phase');
    expect(formatShareSnippet(input([nation]), { style: 'compact' })).toContain('🇦🇱 ALB 2–1 LVA 🇱🇻');
  });
});

describe('the stage line on a card', () => {
  it('a play-off says so; an unknown round says the provider\'s words', () => {
    expect(formatShareSnippet(input([club({ stage: 'PO' })]), { style: 'social' })).toContain('Play-offs');
    const other = formatShareSnippet(input([club({ stage: 'OTHER', stageLabel: 'Qualifying final' })]), { style: 'social' });
    expect(other).toContain('Qualifying final');
  });

  it('an OTHER with no words prints no stage line: no empty line, no dangling separator', () => {
    const out = formatShareSnippet(input([club({ stage: 'OTHER' })]), { style: 'social' });
    const lines = out.split('\n');
    expect(lines.some((l) => l.trim() === '·' || l.endsWith(' ·') || l.startsWith('· '))).toBe(false);
    expect(out).not.toContain('OTHER');
    expect(out).not.toContain('undefined');
    // The body is the match line, its location, then the footer: nothing between.
    const at = lines.indexOf('Emirates Stadium, London');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe('');
  });
});

describe('a club table card', () => {
  const row = (code: string, name: string, points: number): StandingRow => ({
    team: { code, name, id: `espn:${code}` },
    played: 1,
    won: points === 3 ? 1 : 0,
    drawn: 0,
    lost: points === 3 ? 0 : 1,
    goalsFor: points === 3 ? 2 : 1,
    goalsAgainst: points === 3 ? 1 : 2,
    goalDiff: points === 3 ? 1 : -1,
    points,
  });

  it('rows carry rank, code and facts, and nothing in the flag\'s place', () => {
    const out = formatShareTable({
      tables: [{ group: 'LEAGUE', label: 'Premier League', rows: [row('ARS', 'Arsenal', 3), row('CHE', 'Chelsea', 0)] }],
      source: 'espn',
      installLine: 'CLAUDINHO_COMPETITION=eng.1 npx @claudinho/cli table',
    });
    expect(out).toContain('1. ARS  3 pts');
    expect(out).toContain('2. CHE  0 pts');
    expect(out).not.toContain('🏳️');
    expect(out).not.toContain('undefined');
  });
});
