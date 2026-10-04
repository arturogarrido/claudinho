/**
 * A CLI config as a test assembles it by hand. The edge (`resolveConfig`)
 * states where its competition came from; a hand-built config names its
 * competition directly, so it is described as one nothing chose (`default`:
 * the mode line names no source), through core's one constructor of a
 * selection, unless the test states a selection itself. The selection always
 * describes the config's final competition, overrides included.
 */
import { selectedCompetition } from '@claudinho/core';
import type { CliConfig } from '../src/config';

export function described(cfg: Omit<CliConfig, 'selection'> & { selection?: CliConfig['selection'] }): CliConfig {
  return { ...cfg, selection: cfg.selection ?? selectedCompetition(cfg.competition, 'default') };
}
