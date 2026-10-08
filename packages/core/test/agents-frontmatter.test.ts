/**
 * The three project agent definitions (PR C): `.claude/agents/claudinho-{coder,runner,verifier}.md`, with the
 * frontmatter fields this build documents and nothing else, the name equal to the file name, the model one of the
 * aliases the author listed (the build's validator accepts any string, measured: this test is the check), the tools
 * set, and the standing constraints in the body. The first launch is what proves the build loads them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGENTS = join(ROOT, '.claude/agents');
const NAMES = ['claudinho-coder', 'claudinho-runner', 'claudinho-verifier'];
const FIELDS = new Set(['name', 'description', 'model', 'tools', 'isolation', 'effort']);
/** The author's literal list of this build's model aliases (the docs list these four). */
const MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable']);

const split = (raw: string): { fm: Record<string, string>; body: string } => {
  const text = raw.replace(/\r\n/g, '\n'); // a Windows checkout's CRLF
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const fm: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1] as string] = (kv[2] as string).trim();
  }
  return { fm, body: m?.[2] ?? '' };
};

describe('the project agent definitions', () => {
  for (const name of NAMES) {
    it(`${name}: documented fields only, the name its file name, a listed model, tools set`, () => {
      const file = join(AGENTS, `${name}.md`);
      expect(existsSync(file), file).toBe(true);
      const { fm, body } = split(readFileSync(file, 'utf8'));
      expect(Object.keys(fm).filter((k) => !FIELDS.has(k)), 'fields outside the documented set').toEqual([]);
      expect(fm.name).toBe(name);
      expect((fm.description ?? '').length).toBeGreaterThan(20);
      expect(MODELS.has(fm.model ?? ''), `model "${fm.model}" is a listed alias`).toBe(true);
      const tools = (fm.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      expect(tools.length, 'tools set').toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(200);
      expect(body).not.toMatch(/\bdocs\/[\w.-]+/); // the private folder by role only
    });
  }

  it('the coder never pushes, never edits a test, commits once with its trailer', () => {
    const { fm, body } = split(readFileSync(join(AGENTS, 'claudinho-coder.md'), 'utf8'));
    expect(fm.tools ?? '').toMatch(/\bEdit\b/);
    expect(body).toMatch(/never push/i);
    expect(body).toMatch(/never edit[s]? a test|never edits? (?:the )?tests?/i);
    expect(body).toMatch(/on a copy/i); // a wrong test is proven on a copy and reported
    expect(body).toMatch(/one commit/i);
    expect(body).toMatch(/Co-Authored-By/);
  });

  it('the runner works in its own worktree and answers with the verdict line first', () => {
    const { fm, body } = split(readFileSync(join(AGENTS, 'claudinho-runner.md'), 'utf8'));
    expect(fm.isolation).toBe('worktree');
    expect(body).toContain('- Verdict:');
    expect(body).toMatch(/inputs/);
    expect(body).toMatch(/mutation/i);
  });

  it('the verifier drives the verify skill and answers PASS, PASS+NOTES or FAIL', () => {
    const { body } = split(readFileSync(join(AGENTS, 'claudinho-verifier.md'), 'utf8'));
    expect(body).toContain('verify-claudinho');
    expect(body).toContain('scripts/verify.mjs');
    expect(body).toMatch(/PASS\+NOTES/);
    expect(body).toMatch(/\bFAIL\b/);
  });
});
