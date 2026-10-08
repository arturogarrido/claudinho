import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

/** Drive the real MCP protocol so prompts are checked as clients see them. */
async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverT);
  const client = new Client({ name: 'prompts-test', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const promptText = (res: { messages: { content: { type: string; text?: string } }[] }) =>
  res.messages.map((m) => (m.content.type === 'text' ? (m.content.text ?? '') : '')).join('\n');

describe('my_team prompt', () => {
  it('is listed for the competition you follow, with the team optional', async () => {
    await withClient(async (client) => {
      const { prompts } = await client.listPrompts();
      const p = prompts.find((x) => x.name === 'my_team');
      expect(p?.title).toBe('My team');
      expect(p?.description).toMatch(/competition you follow/);
      expect(p?.description).not.toMatch(/World Cup nation/);
      expect(p?.description).toMatch(/World Cup/); // the market read is still the World Cup's, and the description says so
      const team = p?.arguments?.find((a) => a.name === 'team');
      expect(team, 'the team argument').toBeDefined();
      expect(team?.required ?? false, 'a team is optional: with none, the pinned team').toBe(false);
      expect(team?.description).toMatch(/club|nation/i);
      expect(team?.description).toMatch(/follow --team/);
      expect(team?.description).toMatch(/CLAUDINHO_TEAM/);
      expect(team?.description?.indexOf('CLAUDINHO_TEAM'), 'the environment wins, so it is named first').toBeLessThan(
        team?.description?.indexOf('follow --team') ?? -1,
      );
      expect(team?.description).not.toMatch(/World Cup nation/);
      expect(p?.arguments?.map((a) => a.name)).toEqual(['team']);
    });
  });

  it('with a team: guides the agent through the fixture, the standing, and the World Cup-only market read', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team', arguments: { team: 'Arsenal' } });
      const text = promptText(res);
      expect(text).toContain('get_next_fixture');
      expect(text).toContain('get_standings');
      expect(text).toContain('get_market_signal');
      expect(text).toContain('Arsenal');
      // The competition is the one the user follows: the tools are called with no competition argument,
      // never pointed at the World Cup, and a noCompetition answer is relayed as "run claudinho follow".
      expect(text).not.toMatch(/competition:\s*"world-cup"/);
      expect(text).toMatch(/competition I follow/);
      expect(text).toMatch(/no competition argument/);
      expect(text).toMatch(/noCompetition/);
      expect(text).toMatch(/claudinho follow <alias>/);
      // The market read is conditional on the competition and bound to the RETURNED fixture (by its id, never by the
      // team's code: a code selects the team's current match, which can differ from its next one); off the World
      // Cup the agent calls nothing and says nothing about markets.
      expect(text).toMatch(/[Oo]nly when the competition is the World Cup/);
      expect(text).toMatch(/matchId/);
      expect(text).toMatch(/the fixture get_next_fixture returned|the fixture it returned|that fixture's id/);
      expect(text).not.toMatch(/3-letter code/);
      expect(text).toMatch(/do not call get_market_signal/);
      expect(text).toMatch(/say nothing about markets/);
      expect(text).not.toMatch(/anyway/);
      expect(text).not.toContain('market signals are read for the World Cup alone');
      // An empty answer keeps its horizon or verdict WHEN it carries one (the World Cup's "No upcoming fixture found" and
      // a degraded answer carry neither); the competition the answer names is relayed.
      expect(text).toMatch(/no fixture/);
      expect(text).toMatch(/never invent/);
      expect(text).toMatch(/horizon or its verdict when it carries one/);
      // A refused competition (a CLAUDINHO_COMPETITION value the resolver refuses) is a tool error naming the aliases on
      // every tool: relayed, then stop; it is not the no-team error.
      expect(text).toMatch(/error naming the competitions/);
      expect(text).toMatch(/competition (the answer|it) names/);
      // An unknownTeam VERDICT (not an error) is relayed as it is, then the ask; the sentence is gated on the answer and
      // glosses nothing (off the World Cup the verdict is about the table read whole and the next 14 days: a club out
      // in a qualifying round is in no table yet played in the competition).
      expect(text).toMatch(/If it answers unknownTeam, relay that answer as it is/);
      expect(text).not.toMatch(/the team is not in this competition/);
      // The standing is the team's row of its table, and a competition with no table is said so.
      expect(text).toMatch(/row of its table/);
      expect(text).toMatch(/no table/);
      // Next is not now.
      expect(text).toContain('its state (scheduled, in play or finished)');
      expect(text).toMatch(/in play only when the state says so/);
      expect(text).not.toMatch(/World Cup match/);
      expect(text).not.toMatch(/group standing/);
    });
  });

  it('with no team: the pinned team, named as such, and the ask when there is none', async () => {
    await withClient(async (client) => {
      // A client may omit `arguments`, send an empty object, or send the argument left blank: each is "no team".
      const texts = await Promise.all(
        ([undefined, {}, { team: '' }] as (Record<string, string> | undefined)[]).map((args) =>
          client.getPrompt({ name: 'my_team', arguments: args }).then(promptText),
        ),
      );
      expect(new Set(texts).size, 'the three forms of "no team" are one prompt').toBe(1);
      const text = texts[0] as string;
      expect(text).toContain('get_next_fixture');
      expect(text).toMatch(/pinned for this competition with claudinho follow --team/); // a pin applies under its competition alone
      expect(text).toContain('claudinho follow --team');
      expect(text).toMatch(/error naming the competitions/);
      expect(text).toMatch(/with no team/);
      expect(text).toMatch(/ask me which team/);
      expect(text).toMatch(/an error/); // no team given and none pinned (or an unreadable CLAUDINHO_TEAM) is a tool error
      // An unknownTeam answer is relayed; the sentence is gated on the ANSWER, never on a cause (a miss under a partial
      // read, an incomplete roster, or a World Cup code the bundle lacks answer something else, which the empty-answer
      // sentence covers).
      expect(text).toMatch(/If it answers unknownTeam/);
      expect(text).not.toMatch(/answers unknownTeam when/);
      // The error's conditions are the tool's: no team given, CLAUDINHO_TEAM unset AND no pin for this competition, or
      // CLAUDINHO_TEAM holding nothing readable (with CLAUDINHO_TEAM=Chelsea and no pin the tool answers for Chelsea).
      expect(text).toMatch(/CLAUDINHO_TEAM is unset/);
      // The error answer names no team, so the call sentence does not claim every answer does.
      expect(text).not.toMatch(/its answer names the team/);
      expect(text).toMatch(/CLAUDINHO_TEAM/);
      expect(text).not.toContain('undefined');
      expect(text).not.toMatch(/\bnull\b/);
      expect(text).toContain('get_standings');
      expect(text).toContain('get_market_signal');
    });
  });

  it('bounds the team label before it reaches the prompt, as the tools do', async () => {
    await withClient(async (client) => {
      const r = await client.getPrompt({ name: 'my_team', arguments: { team: 'a'.repeat(41) } }).then(
        () => 'accepted',
        (e: Error) => `refused: ${e.message}`,
      );
      expect(r).toMatch(/^refused:/);
      const ok = await client.getPrompt({ name: 'my_team', arguments: { team: 'O&M' } });
      expect(promptText(ok)).toContain('O&M');
      // The bounded LABEL reaches the prompt, not the raw argument: the schema lets ordinary spaces at the ends
      // through (they are a label), and the label drops them.
      const spaced = await client.getPrompt({ name: 'my_team', arguments: { team: ' Arsenal ' } });
      expect(promptText(spaced)).toContain("Tell me about Arsenal's next match");
      expect(promptText(spaced)).not.toContain(" Arsenal 's"); // what the raw argument would print
    });
  });

  it('frames market data as informational only, with an explicit anti-advice guardrail', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'my_team', arguments: { team: 'BRA' } });
      const text = promptText(res);
      expect(text).toMatch(/informational/i);
      // The guardrail itself names betting/trading in a prohibition ("never as
      // betting or trading advice") — assert that negation is present, not that
      // the word is absent.
      expect(text).toMatch(/never[^.]*\b(betting|trading)\b/i);
    });
  });
});
