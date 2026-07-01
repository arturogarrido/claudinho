import { t, stageLabelI18n } from '../i18n';
import { isFinished, outcomeFromScore } from '../normalize';
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
  lang?: string;
}

function teamFromStandings(group: string, position: 1 | 2, tables: GroupStandings[]): Team | undefined {
  const table = tables.find((t) => t.group === group);
  if (!table) return undefined;
  const row = table.rows[position - 1];
  return row?.team;
}

function hasGroupStarted(group: string, tables: GroupStandings[]): boolean {
  const table = tables.find((t) => t.group === group);
  if (!table?.rows.length) return false;
  return table.rows.some((r) => r.played > 0);
}

/** Round-robin group stage: each team plays every other team once. */
function matchesPerTeamInGroup(teamCount: number): number {
  return Math.max(0, teamCount - 1);
}

/** True when every team in the table has played a full round-robin. */
export function isGroupStandingsComplete(table: GroupStandings | undefined): boolean {
  const n = table?.rows.length ?? 0;
  if (n < 2) return false;
  const required = matchesPerTeamInGroup(n);
  return table!.rows.every((r) => r.played >= required);
}

function isGroupComplete(group: string, tables: GroupStandings[]): boolean {
  return isGroupStandingsComplete(tables.find((t) => t.group === group));
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

function confirmedLiveParticipant(team: Team | undefined): ResolvedParticipant | undefined {
  if (!team || team.flag === '🏳️') return undefined;
  return participant(team, 'confirmed');
}

function winnerLabel(ctx: ResolveContext, stage: string, index: number): string {
  return t(ctx.lang, 'bracket.slot.winner', {
    stage: stageLabelI18n(ctx.lang, stage),
    n: String(index),
  });
}

function resolveSlot(
  ref: SlotRef,
  ctx: ResolveContext,
  liveTeam?: Team,
  fixtureInMergedSet = false,
): ResolvedParticipant {
  const liveParticipant = confirmedLiveParticipant(liveTeam);

  switch (ref.kind) {
    case 'seed':
      if (liveParticipant) return liveParticipant;
      return tbd(ref.label);
    case 'group': {
      if (liveParticipant) return liveParticipant;
      if (!ctx.standingsDegraded && hasGroupStarted(ref.group, ctx.tables)) {
        const team = teamFromStandings(ref.group, ref.position, ctx.tables);
        if (team) {
          const status: SlotStatus = isGroupComplete(ref.group, ctx.tables)
            ? 'confirmed'
            : 'projected';
          return participant(team, status);
        }
      }
      const label =
        ref.position === 1
          ? t(ctx.lang, 'bracket.slot.groupWinner', { group: ref.group })
          : t(ctx.lang, 'bracket.slot.groupSecond', { group: ref.group });
      return tbd(label);
    }
    case 'third':
      if (liveParticipant) return liveParticipant;
      return tbd(t(ctx.lang, 'bracket.slot.third', { groups: ref.groups.join('/') }));
    case 'winner': {
      // ESPN's own fixture is authoritative for the pairing: prefer the resolved
      // team it seats in THIS slot over projecting a winner from the bundled feeder
      // topology. The bundled winner-ref indices (parsed from ESPN's placeholder
      // slot labels at generation time) do NOT reliably correspond to ESPN's actual
      // R32→R16 feeder assignment, so projecting from them rendered wrong R16
      // pairings (v0.8.16 P1: "Paraguay vs Mexico" instead of the real ties). Fall
      // back to the feeder ref only when this fixture is absent from the merged set
      // (degraded feed), where no live result exists to resolve anyway — so it stays
      // fail-closed.
      if (liveParticipant) return liveParticipant;
      if (!fixtureInMergedSet) {
        const node = ctx.nodesByKey.get(matchKey(ref.stage, ref.index));
        const match = node ? ctx.matchesById.get(node.matchId) : undefined;
        if (match) {
          const winner = resolveWinner(match);
          if (winner) return participant(winner, 'confirmed');
        }
      }
      return tbd(winnerLabel(ctx, ref.stage, ref.index));
    }
    case 'loser': {
      if (liveParticipant) return liveParticipant;
      if (!fixtureInMergedSet) {
        const node = ctx.nodesByKey.get(matchKey(ref.stage, ref.index));
        const match = node ? ctx.matchesById.get(node.matchId) : undefined;
        if (match) {
          const loser = resolveLoser(match);
          if (loser) return participant(loser, 'confirmed');
        }
      }
      return tbd(
        t(ctx.lang, 'bracket.slot.loser', {
          stage: stageLabelI18n(ctx.lang, ref.stage),
          n: String(ref.index),
        }),
      );
    }
    default:
      return tbd(t(ctx.lang, 'bracket.slot.tbd'));
  }
}

/**
 * Resolve the bundled topology against merged knockout matches and standings.
 * Group slots project from live standings once a group has started; confirmed when
 * the group is fully played. Winner/loser slots require a confirmed FT result.
 */
export function buildBracketView(
  topology: BracketTopology,
  matches: Match[],
  tables: GroupStandings[],
  standingsDegraded: boolean,
  liveDegraded: boolean,
  filterStage?: string,
  lang?: string,
): BracketView {
  const knockout = matches.filter((m) => m.stage !== 'GROUP' && m.stage !== 'FRIENDLY');
  const matchesById = new Map(knockout.map((m) => [m.id, m]));
  const nodesByKey = new Map(topology.matches.map((n) => [matchKey(n.stage, n.index), n]));
  const ctx: ResolveContext = { nodesByKey, matchesById, tables, standingsDegraded, lang };

  const want = filterStage?.toUpperCase();
  const stages: BracketStageView[] = [];

  for (const stage of topology.stages) {
    if (want && stage !== want) continue;
    const nodes = topology.matches.filter((n) => n.stage === stage);
    const matchViews: BracketMatchView[] = nodes.map((node) => {
      // Whether this knockout fixture is in the merged set (live overlay merged
      // over the bundled skeleton) vs a synthesized TBD. When present, its
      // home/away are authoritative (ESPN's resolved team or a genuine TBD); only
      // when it's missing entirely do we fall back to the static feeder topology.
      const fixtureInMergedSet = matchesById.has(node.matchId);
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
        home: resolveSlot(node.home, ctx, match.home, fixtureInMergedSet),
        away: resolveSlot(node.away, ctx, match.away, fixtureInMergedSet),
        match,
      };
    });
    stages.push({
      stage,
      label: stageLabelI18n(lang, stage),
      matches: matchViews,
    });
  }

  return {
    stages,
    degraded: liveDegraded,
    standingsDegraded,
  };
}
