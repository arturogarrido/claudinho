/**
 * The plugin's type contract, `packages/plugin/types/index.d.ts`, compiled on its own.
 *
 * `claude plugin validate --strict` is the plugin's type-check, and it reports no type error INSIDE a declaration
 * file: a name misspelled in the contract is not an error there, it turns the value it types into `any`, and the
 * modules that read it then check against nothing. So the contract is compiled here, with the TypeScript the
 * workspace builds with, against a stub for the engine's module that declares only what the contract adds to (an
 * empty `PluginState`), together with a reader of both: a module that imports the state from the engine's module and a
 * type from the contract, as the plugin's modules do. The reader is what makes the compiler load the stub and hold
 * the contract to what a module can import from it; the contract alone compiles without either. What this does not prove: anything the engine's own declarations would say (they are not in
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
  const STUB = 'export interface PluginState {}\n';
  /** A module as the plugin's are: the state from the engine's module, a type from the contract, one read of the state. */
  const READER = "import type { PluginState } from 'claude-code'\nimport type { ClaudinhoBand } from './types'\nexport const band = (state: PluginState): ClaudinhoBand => state.claudinho.band\n";
  /** The diagnostics of `contract` as the file `types/index.d.ts`, beside a stub `claude-code` module and the reader. */
  const diagnostics = (contract: string, stub = STUB): string[] => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-contract-'));
    bases.push(base);
    const file = join(base, 'types/index.d.ts');
    const engine = join(base, 'node_modules/claude-code/index.d.ts');
    const reader = join(base, 'reader.ts');
    for (const f of [file, engine]) mkdirSync(dirname(f), { recursive: true });
    writeFileSync(file, contract);
    writeFileSync(engine, stub);
    writeFileSync(reader, READER);
    const program = ts.createProgram([file, reader], {
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

  it('is held to what a module reads of it: the stub is loaded, and a contract whose types are all local is an error', () => {
    // The stub is part of the compilation: an error planted in it is reported.
    expect(diagnostics(CONTRACT, 'export interface PluginState { x: NotDeclared }\n').join('\n')).toContain("Cannot find name 'NotDeclared'.");
    // Every type of the contract turned local: the file is no module, and no module could import from it. (One type
    // turned local is not an error for this compiler; the validator's own contract rule refuses that in CI.)
    const local = CONTRACT.replace(/^export type /gm, 'type ');
    expect(local).not.toBe(CONTRACT);
    expect(diagnostics(local).length).toBeGreaterThan(0);
    // The state without its `band`: the reader's one read fails.
    const less = CONTRACT.replace(/^\s*band: ClaudinhoBand\r?\n/m, '');
    expect(less).not.toBe(CONTRACT);
    expect(diagnostics(less).join('\n')).toContain("'band'");
  });

  it('adds to the engine\'s module and imports nothing: the stub declares all the contract needs of it', () => {
    expect(CONTRACT).toMatch(/^declare module 'claude-code' \{\r?\n {2}interface PluginState \{/m);
    expect(CONTRACT).not.toMatch(/^\s*import\s/m);
  });
});
