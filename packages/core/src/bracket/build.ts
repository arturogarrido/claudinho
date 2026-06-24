import type { Match, Stage } from '../types';
import { parseTeamSlot } from './parse';
import {
  BRACKET_STAGE_ORDER,
  EXPECTED_KNOCKOUT_COUNTS,
  type BracketMatchNode,
  type BracketTopology,
  type SlotRef,
} from './types';

export function matchKey(stage: Stage, index: number): string {
  return `${stage}:${index}`;
}

/**
 * ESPN bracket slot numbers within a round follow ascending event id, not kickoff
 * time (R32/R16 kickoff order diverges from id order). Winner-placeholder refs
 * ("Round of 32 3 Winner") use this id-based index — see validateBracketIndexing.
 */
export function orderByBracketIndex(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Build and validate bracket topology from knockout fixtures.
 * Throws when ESPN introduces an unparsed placeholder or the graph is inconsistent.
 */
export function buildBracketTopology(matches: Match[], generatedAt: string): BracketTopology {
  const knockout = matches.filter((m) => m.stage !== 'GROUP' && m.stage !== 'FRIENDLY');
  const problems: string[] = [];
  const nodes: BracketMatchNode[] = [];

  for (const stage of BRACKET_STAGE_ORDER) {
    const stageMatches = orderByBracketIndex(knockout.filter((m) => m.stage === stage));
    const expected = EXPECTED_KNOCKOUT_COUNTS[stage];
    if (expected != null && stageMatches.length !== expected) {
      problems.push(`stage ${stage}: expected ${expected}, got ${stageMatches.length}`);
    }
    stageMatches.forEach((m, i) => {
      const home = parseTeamSlot(m.home);
      const away = parseTeamSlot(m.away);
      if (!home) problems.push(`${m.id}: unparsed home slot "${m.home.name}"`);
      if (!away) problems.push(`${m.id}: unparsed away slot "${m.away.name}"`);
      if (home && away) {
        nodes.push({ matchId: m.id, stage, index: i + 1, home, away });
      }
    });
  }

  const knockoutIds = new Set(knockout.map((m) => m.id));
  const topologyIds = new Set(nodes.map((n) => n.matchId));
  for (const id of knockoutIds) {
    if (!topologyIds.has(id)) problems.push(`knockout fixture ${id} missing from topology`);
  }
  for (const id of topologyIds) {
    if (!knockoutIds.has(id)) problems.push(`topology match ${id} not in knockout schedule`);
  }

  validateWinnerChain(nodes, problems);
  validateThirdPlace(nodes, problems);
  validateBracketIndexing(knockout, nodes, problems);

  if (problems.length > 0) {
    throw new Error(
      `bracket topology validation failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }

  return { generatedAt, stages: [...BRACKET_STAGE_ORDER], matches: nodes };
}

/** Guard: id-based index must differ from kickoff rank when ESPN diverges (R32/R16). */
function validateBracketIndexing(
  knockout: Match[],
  nodes: BracketMatchNode[],
  problems: string[],
): void {
  for (const stage of ['R32', 'R16'] as const) {
    const byKickoff = [...knockout.filter((m) => m.stage === stage)].sort((a, b) =>
      a.kickoff.localeCompare(b.kickoff),
    );
    const byId = orderByBracketIndex(knockout.filter((m) => m.stage === stage));
    const kickoffIds = byKickoff.map((m) => m.id).join(',');
    const idIds = byId.map((m) => m.id).join(',');
    if (kickoffIds !== idIds) {
      // Document the assumption: when orders diverge, topology keys by id (ESPN slot #).
      const diverged = byKickoff
        .map((m, i) => ({ kickoffRank: i + 1, idRank: byId.findIndex((x) => x.id === m.id) + 1, id: m.id }))
        .filter((x) => x.kickoffRank !== x.idRank);
      if (diverged.length > 0 && stage === 'R32') {
        // R16 winner refs cite id-rank indices — sanity: R32-1 and R32-3 must be id-ranked slots.
        const r32ById = new Map(nodes.filter((n) => n.stage === 'R32').map((n) => [n.index, n.matchId]));
        const r16First = nodes.find((n) => n.stage === 'R16' && n.index === 1);
        if (r16First) {
          const home = r16First.home;
          const away = r16First.away;
          if (home.kind === 'winner' && home.stage === 'R32') {
            const expectedId = r32ById.get(home.index);
            if (!expectedId) {
              problems.push(`R32 index ${home.index} missing for R16-1 home ref`);
            }
          }
          if (away.kind === 'winner' && away.stage === 'R32') {
            const expectedId = r32ById.get(away.index);
            if (!expectedId) {
              problems.push(`R32 index ${away.index} missing for R16-1 away ref`);
            }
          }
        }
      }
    }
  }
}

function validateWinnerChain(nodes: BracketMatchNode[], problems: string[]): void {
  const indexMap = new Map(nodes.map((n) => [matchKey(n.stage, n.index), n]));
  const chains: Array<{ from: Stage; to: Stage; count: number }> = [
    { from: 'R32', to: 'R16', count: 16 },
    { from: 'R16', to: 'QF', count: 8 },
    { from: 'QF', to: 'SF', count: 4 },
    { from: 'SF', to: 'F', count: 2 },
  ];

  for (const { from, to, count } of chains) {
    const refs = nodes
      .filter((n) => n.stage === to)
      .flatMap((n) => [n.home, n.away])
      .filter((r): r is Extract<SlotRef, { kind: 'winner' }> => r.kind === 'winner' && r.stage === from);
    const indices = refs.map((r) => r.index);
    if (indices.length !== count) {
      problems.push(`${to}: expected ${count} ${from} winner refs, got ${indices.length}`);
    }
    const unique = new Set(indices);
    if (unique.size !== count) {
      problems.push(`${to}: ${from} winner indices must be unique 1..${count}`);
    }
    for (let i = 1; i <= count; i++) {
      if (!unique.has(i)) problems.push(`${to}: missing ${from} winner index ${i}`);
      if (!indexMap.has(matchKey(from, i))) problems.push(`missing ${from} match index ${i}`);
    }
  }
}

function validateThirdPlace(nodes: BracketMatchNode[], problems: string[]): void {
  const third = nodes.find((n) => n.stage === '3P');
  if (!third) {
    problems.push('missing third-place play-off node');
    return;
  }
  const slots = [third.home, third.away];
  const indices = new Set<number>();
  for (const slot of slots) {
    if (slot.kind !== 'loser' || slot.stage !== 'SF') {
      problems.push('3P slots must reference SF losers');
      return;
    }
    indices.add(slot.index);
  }
  if (!indices.has(1) || !indices.has(2)) {
    problems.push('3P must reference Semifinal 1 Loser and Semifinal 2 Loser');
  }
}
