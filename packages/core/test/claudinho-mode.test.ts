/**
 * The `claudinho-mode` router skill and its playbooks (PR C): the router loads at the start of a task and names a
 * playbook per task kind; a playbook QUOTES the commands as they are run (the gate line, the push line) and never
 * the paraphrase `gate.sh` exists to replace; every path a playbook or the router names exists; the Cursor mirror of
 * the router is byte-equal; AGENTS.md opens with an index naming every section; the three Cursor glob rules point at
 * a guide file that exists. Structure and existence only: the prose is the readers'.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILL = join(ROOT, '.claude/skills/claudinho-mode/SKILL.md');
const MIRROR = join(ROOT, '.cursor/skills/claudinho-mode/SKILL.md');
const PLAYBOOKS = join(ROOT, '.claude/skills/claudinho-mode/playbooks');
const KINDS = ['bug-fix', 'feature', 'review-round', 'confirmation-round', 'docs-only', 'dependency-bump', 'release'];
const GATE_LINE = 'bash scripts/gate.sh';
const PUSH_LINE = 'bash scripts/push-and-watch.sh';
const PARAPHRASE = /build, typecheck, test, lint, pack guard/i;
// A Windows checkout converts LF to CRLF: every text is read with LF so the frontmatter and line rules hold there too.
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const frontmatter = (text: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1] as string] = (kv[2] as string).trim();
  }
  return out;
};
/** Every backticked repository path a text names (scripts/, guides/, .claude/, .cursor/, packages/, .github/). */
const namedPaths = (text: string): string[] =>
  [...text.matchAll(/`((?:scripts|guides|packages|\.claude|\.cursor|\.github)\/[\w./@-]+)`/g)].map((m) => m[1] as string);

describe('the claudinho-mode router', () => {
  it('exists, is mirrored byte-equal for Cursor, and says when it loads', () => {
    expect(existsSync(SKILL), SKILL).toBe(true);
    expect(existsSync(MIRROR), MIRROR).toBe(true);
    expect(readFileSync(SKILL).equals(readFileSync(MIRROR)), 'the two SKILL.md copies are byte-equal').toBe(true);
    const fm = frontmatter(read(SKILL));
    expect(fm.name).toBe('claudinho-mode');
    expect(fm.description ?? '').toMatch(/Use at the start of any task/);
  });

  it('names the seven playbooks, each existing, and a fallback row', () => {
    const text = read(SKILL);
    for (const kind of KINDS) {
      expect(text, `the router names ${kind}`).toContain(`playbooks/${kind}.md`);
      expect(existsSync(join(PLAYBOOKS, `${kind}.md`)), `${kind}.md exists`).toBe(true);
    }
    expect(text).toMatch(/fallback/i);
    const extra = existsSync(PLAYBOOKS) ? readdirSync(PLAYBOOKS).filter((f) => !KINDS.includes(f.replace(/\.md$/, ''))) : [];
    expect(extra, 'no playbook the router does not name').toEqual([]);
  });

  it('every path the router and the playbooks name exists', () => {
    const texts = [read(SKILL), ...KINDS.map((k) => read(join(PLAYBOOKS, `${k}.md`)))];
    for (const text of texts) for (const p of namedPaths(text)) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });
});

describe('the playbooks', () => {
  for (const kind of KINDS) {
    it(`${kind}: quotes the gate and push lines, never the paraphrase, and carries the reply shape`, () => {
      const text = read(join(PLAYBOOKS, `${kind}.md`));
      // The lines as they are run, each on a line of its own (a mention inside a sentence is not the quoted command).
      expect(text).toMatch(/^\s*bash scripts\/gate\.sh\s*$/m);
      expect(text).toMatch(/^\s*bash scripts\/push-and-watch\.sh <branch>\s*$/m);
      expect(text).toContain(GATE_LINE);
      expect(text).toContain(PUSH_LINE);
      expect(text).not.toMatch(PARAPHRASE);
      expect(text).toContain('What I need from you');
      expect(text).toMatch(/Blocked on you/);
      expect(text).toMatch(/Co-Authored-By/);
      // The private folder is named by role only: a path under it is refused by check-pack as well.
      expect(text).not.toMatch(/\bdocs\/[\w.-]+/);
    });
  }
  it('the PR-making playbooks create the branch, the worktree and the pull request their later steps use', () => {
    for (const kind of ['bug-fix', 'feature', 'docs-only']) {
      const text = read(join(PLAYBOOKS, `${kind}.md`));
      expect(text, `${kind}: a worktree on a new branch`).toMatch(/git worktree add -b <branch>|git switch -c <branch>/);
      expect(text, `${kind}: the pull request`).toContain('gh pr create');
      expect(text, `${kind}: the first push has no run to watch`).toContain('--allow-no-run');
    }
  });

  it('every playbook that ends in a merge requires the review and confirmation rounds first', () => {
    for (const kind of ['bug-fix', 'feature', 'docs-only', 'dependency-bump', 'release']) {
      const text = read(join(PLAYBOOKS, `${kind}.md`));
      expect(text, `${kind}: the confirmation round`).toContain('playbooks/confirmation-round.md');
      expect(text, `${kind}: the merge bound to the confirmed SHA`).toMatch(/--match-head-commit/);
    }
  });

  it('the feature and bug-fix playbooks name the verify skill; the release playbook names release:qa', () => {
    expect(read(join(PLAYBOOKS, 'feature.md'))).toContain('scripts/verify.mjs');
    expect(read(join(PLAYBOOKS, 'bug-fix.md'))).toContain('scripts/verify.mjs');
    expect(read(join(PLAYBOOKS, 'release.md'))).toContain('pnpm release:qa');
  });
});

describe('AGENTS.md opens with an index', () => {
  it('the first section is the index and it names every other section', () => {
    const text = read(join(ROOT, 'AGENTS.md'));
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => (m[1] as string).trim());
    expect(headings[0]).toBe('Index');
    const index = text.slice(text.indexOf('## Index'), text.indexOf('## ', text.indexOf('## Index') + 3));
    for (const h of headings.slice(1)) expect(index, `the index names "${h}"`).toContain(h);
  });
});

describe('the Cursor glob rules point at a guide', () => {
  for (const rule of ['surface-parity.mdc', 'trust-boundary.mdc', 'bundle-bracket-pr.mdc']) {
    it(`${rule} names a guides/conventions file that exists`, () => {
      const text = read(join(ROOT, '.cursor/rules', rule));
      const guides = [...text.matchAll(/guides\/conventions\/[\w.-]+\.md/g)].map((m) => m[0]);
      expect(guides.length, `${rule} points at a guide`).toBeGreaterThan(0);
      for (const g of guides) expect(existsSync(join(ROOT, g)) && statSync(join(ROOT, g)).isFile(), g).toBe(true);
    });
  }
});
