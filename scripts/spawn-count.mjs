/**
 * A preload for the release QA and its test (0.11 · 2.7): with QA_SPAWN_LOG
 * naming a file, `node --import <this file>` (or the same in NODE_OPTIONS)
 * records every `child_process.spawn` the process makes there, one JSON line
 * each, and does NOT start it (the caller gets an inert child). Whether a
 * seeded `prompt` starts a refresher is then answered by a count, and no
 * detached process outlives the run's temporary directories. Without
 * QA_SPAWN_LOG it changes nothing.
 */
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const log = process.env.QA_SPAWN_LOG;
if (log) {
  cp.spawn = (command, args = []) => {
    appendFileSync(log, `${JSON.stringify([command, ...args])}\n`);
    const child = new EventEmitter();
    child.unref = () => child;
    child.kill = () => false;
    return child;
  };
  // The CLI imports `spawn` by name: refresh the ES module bindings of the builtin.
  syncBuiltinESMExports();
}
