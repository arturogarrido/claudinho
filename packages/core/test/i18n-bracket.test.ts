import { describe, expect, it } from 'vitest';
import { formatBracketList, formatShareBracket } from '../src/bracket/format';
import { buildBracketView } from '../src/bracket/resolve';
import { loadBracketTopology } from '../src/bracket/topology';
import { allFixtures } from '../src/schedule';
import { stageLabelI18n, t } from '../src/i18n';

describe('bracket i18n', () => {
  it('translates catalog keys for es, pt, and fr', () => {
    expect(t('es', 'bracket.title')).toBe('Cuadro de eliminatorias');
    expect(t('pt', 'bracket.degraded')).toContain('Placar ao vivo indisponível');
    expect(t('fr', 'stage.r32')).toBe('Seizièmes de finale');
  });

  it('localizes stage labels and slot placeholders in buildBracketView', () => {
    const topology = loadBracketTopology();
    const baseKo = allFixtures().filter((m) => m.stage !== 'GROUP');
    const view = buildBracketView(topology, baseKo, [], true, true, undefined, 'es');
    expect(view.stages[0]?.label).toBe(stageLabelI18n('es', view.stages[0]!.stage));
    const r32 = view.stages.find((s) => s.stage === 'R32');
    const groupSlot = r32?.matches
      .flatMap((m) => [m.home, m.away])
      .find((p) => p.status === 'tbd' && /grupo [A-L]/i.test(p.label));
    expect(groupSlot?.label).toMatch(/grupo [A-L]/i);
  });

  it('localizes share bracket cards', () => {
    const topology = loadBracketTopology();
    const baseKo = allFixtures().filter((m) => m.stage !== 'GROUP');
    const view = buildBracketView(topology, baseKo, [], true, true, undefined, 'pt');
    const card = formatShareBracket({ view }, { locale: 'pt' });
    expect(card).toContain('Chave do mata-mata · 2026');
    expect(card).toContain('Placar ao vivo indisponível');
  });

  it('localizes formatBracketList footers', () => {
    const topology = loadBracketTopology();
    const baseKo = allFixtures().filter((m) => m.stage !== 'GROUP');
    const view = buildBracketView(topology, baseKo, [], true, true, undefined, 'fr');
    const text = formatBracketList(view, { footer: true, locale: 'fr' });
    expect(text).toContain('Scores en direct indisponibles');
    expect(text).toContain('Seizièmes de finale');
  });
});
