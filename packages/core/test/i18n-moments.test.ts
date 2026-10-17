/**
 * The plugin's moments and band in the reader's language (0.12.0, item 3; the design packet's C1 and C2): new core
 * keys in the four locales, never an existing key reused (`event.goal` and `status.fullTime` say other things).
 *
 *   - `moment.goal`, `moment.ownGoal`, `moment.ownGoalDetail`, `moment.goalFor`, `moment.goals`,
 *     `moment.scoreUpdated`, `moment.penalties`, `moment.fullTime`, `moment.win`, `moment.draw`: the ten words
 *     `claudinho ambient --json` sends as `words` (templates: `{team}` left for the plugin to fill with its `names`);
 *   - `ambient.syncing`: the ambient line's `live · syncing…` (the statusline's own `prompt` stays English).
 *
 * Each value is at most 40 characters; `goalFor` and `win` hold `{team}` exactly once, the others none (C6, which
 * the plugin checks, so a catalog value that broke it would send every reader to the English fallback).
 */
import { describe, expect, it } from 'vitest';
import { countdownPhrase, t } from '../src/index';

type Lang = 'en' | 'es' | 'pt' | 'fr';
const MOMENTS: Record<string, Record<Lang, string>> = {
  'moment.goal': { en: 'GOAL!', es: '¡GOL!', pt: 'GOL!', fr: 'BUT !' },
  'moment.ownGoal': { en: 'Own goal', es: 'Gol en contra', pt: 'Gol contra', fr: 'But contre son camp' },
  'moment.ownGoalDetail': { en: 'own goal', es: 'gol en contra', pt: 'gol contra', fr: 'contre son camp' },
  'moment.goalFor': { en: 'Goal for {team}', es: 'Gol de {team}', pt: 'Gol · {team}', fr: 'But pour {team}' },
  'moment.goals': { en: 'Goals', es: 'Goles', pt: 'Gols', fr: 'Buts' },
  'moment.scoreUpdated': { en: 'Score updated', es: 'Marcador corregido', pt: 'Placar corrigido', fr: 'Score corrigé' },
  'moment.penalties': { en: 'Penalties', es: 'Penales', pt: 'Pênaltis', fr: 'Tirs au but' },
  'moment.fullTime': { en: 'Full time', es: 'Final', pt: 'Fim de jogo', fr: 'Fin du match' },
  'moment.win': { en: '{team} win', es: 'Gana {team}', pt: '{team} vence', fr: '{team} gagne' },
  'moment.draw': { en: 'Draw', es: 'Empate', pt: 'Empate', fr: 'Match nul' },
};
const SYNCING: Record<Lang, string> = {
  en: 'live · syncing…',
  es: 'en vivo · sincronizando…',
  pt: 'ao vivo · sincronizando…',
  fr: 'en direct · synchronisation…',
};
const LANGS: Lang[] = ['en', 'es', 'pt', 'fr'];

describe('the moment words, one key each, in the four locales', () => {
  for (const [key, byLang] of Object.entries(MOMENTS)) {
    for (const lang of LANGS) {
      it(`${key} in ${lang}: ${byLang[lang]}`, () => {
        expect(t(lang, key)).toBe(byLang[lang]);
      });
    }
  }
});

describe('the ambient syncing phrase, one key, in the four locales', () => {
  for (const lang of LANGS) {
    it(`ambient.syncing in ${lang}: ${SYNCING[lang]}`, () => {
      expect(t(lang, 'ambient.syncing')).toBe(SYNCING[lang]);
    });
  }
});

describe('every moment value is one the plugin reads whole (C6)', () => {
  for (const lang of LANGS) {
    it(`${lang}: each value at most 40 characters; {team} once in goalFor and win, never elsewhere`, () => {
      for (const key of Object.keys(MOMENTS)) {
        const v = t(lang, key);
        expect(v, key).not.toBe(key); // a key echoed is a missing key
        expect(v.length, key).toBeLessThanOrEqual(40);
        const teams = v.split('{team}').length - 1;
        expect(teams, key).toBe(key === 'moment.goalFor' || key === 'moment.win' ? 1 : 0);
      }
    });
  }
});

describe('no existing key is reused: event.goal and status.fullTime keep their own words', () => {
  it('event.goal is the timeline row word, status.fullTime the MCP text word', () => {
    expect(t('en', 'event.goal')).toBe('Goal');
    expect(t('en', 'status.fullTime')).toBe('full-time');
    expect(t('es', 'event.goal')).not.toBe(t('es', 'moment.goal'));
  });
});

describe("the countdown phrase the ambient line will use (core's one rule, unchanged)", () => {
  const from = new Date('2026-10-17T15:00:00Z');
  const kickoff = new Date(from.getTime() + 17 * 60_000).toISOString();
  for (const [lang, phrase] of [['en', 'in 17m'], ['es', 'en 17m'], ['pt', 'em 17m'], ['fr', 'dans 17m']] as const) {
    it(`${lang}: ${phrase}`, () => {
      expect(countdownPhrase(lang, kickoff, from)).toBe(phrase);
    });
  }
});
