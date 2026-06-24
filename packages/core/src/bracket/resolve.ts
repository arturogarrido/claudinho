import { isFinished, outcomeFromScore, stageLabel } from '../normalize';
import type { GroupStandings } from '../standings';
import type { Match, Team } from '../types';
import { matchKey } from './build';
import type {
  BracketMatchNode,
  BracketMatchView,
  BracketStageView,
  BracketTopology,
  BracketView,
  ResolvedParticipant,
  SlotRef,
  SlotStatus,
} from './types';
import { teamFromMatch } from './types';

interface ResolveContext {
  nodesByKey: Map<string, BracketMatchNode>;
  matchesById: Map<string, Match>;
  tables: GroupStandings[];
  standingsDegraded: boolean;
}

function isGroupComplete(group: string, tables: GroupStandings[], standingsDegraded: boolean): boolean {
  if (standingsDegraded) return false;
  const table = tables.find((t) => t.group === group);
  if (!table?.rows.length || table.rows.length !== 4) return false;
  return table.rows.every((r) => r.played >= 3);
}

function teamFromStandings(group: string, position: 1 | 2, tables: GroupStandings[]): Team | undefined {
  const table = tables.find((t) => t.group === group);
  if (!table) return undefined;
  const row = table.rows[position - 1];
  return row?.team;
}

function resolveWinner(match: Match): Team | undefined {
  if (!isFinished(match.status)) return undefined;
  if (match.winnerCode) {
    const w = teamFromMatch(match, match.winnerCode);
    if (w && w.flag !== '🏳️') return w;
  }
  if (!match.score) return undefined;
  const outcome = outcomeFromScore(match.score.home, match.score.away);
  if (outcome === 'H') return match.home.flag !== '🏳️' ? match.home : undefined;
  if (outcome === 'A') return match.away.flag !== '🏳️' ? match.away : undefined;
  return undefined;
}

function resolveLoser(match: Match): Team | undefined {
  if (!isFinished(match.status)) return undefined;
  if (match.winnerCode) {
    const winner = teamFromMatch(match, match.winnerCode);
    if (winner?.code === match.home.code) {
      return match.away.flag !== '🏳️' ? match.away : undefined;
    }
    if (winner?.code === match.away.code) {
      return match.home.flag !== '🏳️' ? match.home : undefined;
    }
  }
  if (!match.score) return undefined;
  const outcome = outcomeFromScore(match.score.home, match.score.away);
  if (outcome === 'H') return match.away.flag !== '🏳️' ? match.away : undefined;
  if (outcome === 'A') return match.home.flag !== '🏳️' ? match.home : undefined;
  return undefined;
}

function participant(team: Team, status: SlotStatus): ResolvedParticipant {
  return { label: team.name, flag: team.flag, code: team.code, status };
}

function tbd(label: string): ResolvedParticipant {
  return { label, flag: '🏳️', status: 'tbd' };
}

function winnerLabel(stage: string, index: number): string {
  return `${stage}-${index} winner`;
}

function resolveSlot(ref: SlotRef, ctx: ResolveContext): ResolvedParticipant {
  switch (ref.kind) {
    case 'seed':
      return tbd(ref.label);
    case 'group': {
      if (isGroupComplete(ref.group, ctx.tables, ctx.standingsDegraded)) {
        const team = teamFromStandings(ref.group, ref.position, ctx.tables);
        if (team) return participant(team, 'projected');
      }
      const label =
        ref.position === 1 ? `Group ${ref.group} winner` : `Group ${ref.group} 2nd`;
      return tbd(label);
    }
    case 'third':
      return tbd(`3rd (${ref.groups.join('/')})`);
    case 'winner': {
      const node = ctx.nodesByKey.get(matchKey(ref.stage, ref.index));
      const match = node ? ctx.matchesById.get(node.matchId) : undefined;
      if (match) {
        const winner = resolveWinner(match);
        if (winner) return participant(winner, 'confirmed');
      }
      return tbd(winnerLabel(ref.stage, ref.index));
    }
    case 'loser': {
      const node = ctx.nodesByKey.get(matchKey(ref.stage, ref.index));
      const match = node ? ctx.matchesById.get(node.matchId) : undefined;
      if (match) {
        const loser = resolveLoser(match);
        if (loser) return participant(loser, 'confirmed');
      }
      return tbd(`${ref.stage}-${ref.index} loser`);
    }
    default:
      return tbd('TBD');
  }
}

/**
 * Resolve the bundled topology against merged knockout matches and standings.
 * Group slots project only when the group is fully played; winner/loser slots
 * require a confirmed FT result on the source match.
 */
export function buildBracketView(
  topology: BracketTopology,
  matches: Match[],
  tables: GroupStandings[],
  standingsDegraded: boolean,
  liveDegraded: boolean,
  filterStage?: string,
): BracketView {
  const knockout = matches.filter((m) => m.stage !== 'GROUP' && m.stage !== 'FRIENDLY');
  const matchesById = new Map(knockout.map((m) => [m.id, m]));
  const nodesByKey = new Map(topology.matches.map((n) => [matchKey(n.stage, n.index), n]));
  const ctx: ResolveContext = { nodesByKey, matchesById, tables, standingsDegraded };

  const want = filterStage?.toUpperCase();
  const stages: BracketStageView[] = [];

  for (const stage of topology.stages) {
    if (want && stage !== want) continue;
    const nodes = topology.matches.filter((n) => n.stage === stage);
    const matchViews: BracketMatchView[] = nodes.map((node) => {
      const match =
        matchesById.get(node.matchId) ??
        ({
          id: node.matchId,
          stage: node.stage,
          kickoff: '',
          venue: '',
          home: { code: '?', name: 'TBD', flag: '🏳️' },
          away: { code: '?', name: 'TBD', flag: '🏳️' },
          status: 'SCHEDULED',
          updatedAt: '',
        } satisfies Match);
      return {
        matchId: node.matchId,
        stage: node.stage,
        index: node.index,
        kickoff: match.kickoff,
        home: resolveSlot(node.home, ctx),
        away: resolveSlot(node.away, ctx),
        match,
      };
    });
    stages.push({
      stage,
      label: stageLabel({ stage, group: undefined }),
      matches: matchViews,
    });
  }

  return {
    stages,
    degraded: liveDegraded,
    standingsDegraded,
  };
}
