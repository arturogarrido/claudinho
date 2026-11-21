/**
 * The plugin's type contract, `packages/plugin/types/index.d.ts`, compiled on its own.
 *
 * `claude plugin validate --strict` is the plugin's type-check, and it reports no type error INSIDE a declaration
 * file: a name misspelled in the contract is not an error there, it turns the value it types into `any`, and the
 * modules that read it then check against nothing. So the contract is compiled here, with the TypeScript the
 * workspace builds with, against a stub for the engine's module that declares only what the contract adds to (an
 * empty `PluginState`). What this does not prove: anything the engine's own declarations would say (they are not in
 * the repository); the engine's color builder's declaration file and its `.js` module, which are the engine's files,
 * copied unchanged.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const CONTRACT = readFileSync(join(ROOT, 'packages/plugin/types/index.d.ts'), 'utf8');

describe("the plugin's type contract, compiled", () => {
  const bases: string[] = [];
  afterAll(() => {
    for (const b of bases) rmSync(b, { recursive: true, force: true });
  });
  /** The diagnostics of `contract` as the file `types/index.d.ts`, beside a stub `claude-code` module. */
  const diagnostics = (contract: string): string[] => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-contract-'));
    bases.push(base);
    const file = join(base, 'types/index.d.ts');
    const engine = join(base, 'node_modules/claude-code/index.d.ts');
    for (const f of [file, engine]) mkdirSync(dirname(f), { recursive: true });
    writeFileSync(file, contract);
    writeFileSync(engine, 'export interface PluginState {}\n');
    const program = ts.createProgram([file], {
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      types: [],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
    });
    return ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  };

  it('has no error of its own: every name it uses is one it declares', () => {
    expect(diagnostics(CONTRACT)).toEqual([]);
  });

  it('a misspelled name in the contract is an error here (the validator reports none inside a declaration file)', () => {
    // The state's `band` typed by a name the contract does not declare.
    const typo = CONTRACT.replace('band: ClaudinhoBand', 'band: ClaudinhoBnad');
    expect(typo).not.toBe(CONTRACT);
    const found = diagnostics(typo);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Cannot find name 'ClaudinhoBnad'.");
    // A syntax error is one too.
    expect(diagnostics(`${CONTRACT}\nexport type = 1\n`).length).toBeGreaterThan(0);
  });

  it('adds to the engine\'s module and imports nothing: the stub declares all the contract needs of it', () => {
    expect(CONTRACT).toMatch(/^declare module 'claude-code' \{\r?\n {2}interface PluginState \{/m);
    expect(CONTRACT).not.toMatch(/^\s*import\s/m);
  });
});
