/**
 * A preload for the release QA, the verify-claudinho control CLI and their
 * tests: with QA_SPAWN_LOG naming a file, `node --import <this file>` (or the
 * same in NODE_OPTIONS) replaces the SEVEN launch functions of
 * `node:child_process` (`spawn`, `fork`, `exec`, `execFile`, `spawnSync`,
 * `execSync`, `execFileSync`), records every call there, one JSON line
 * `[command, ...args]` each (a command STRING, `exec`'s or `execSync`'s, is the
 * one element), and starts NOTHING:
 *   - `spawn` and `fork` return an inert child;
 *   - `exec` and `execFile` return an inert child and, when the last argument is
 *     a callback, call it on the next tick with `(null, '', '')`;
 *   - `spawnSync` returns `{ pid: 0, output: [null, '', ''], stdout: '',
 *     stderr: '', status: 0, signal: null }`;
 *   - `execSync` and `execFileSync` return `''`.
 * Whether a seeded `prompt` starts a refresher is then answered by a count,
 * and no process outlives the run's temporary directories. Without
 * QA_SPAWN_LOG it changes nothing.
 */
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const log = process.env.QA_SPAWN_LOG;

/** One call, one line: the command, then its argument list when it has one. */
function record(command, args) {
  appendFileSync(log, `${JSON.stringify([command, ...(Array.isArray(args) ? args : [])])}\n`);
}

/** A child that never ran: it emits nothing, and unref and kill do nothing. */
function inertChild() {
  const child = new EventEmitter();
  child.unref = () => child;
  child.kill = () => false;
  return child;
}

/** `exec`'s and `execFile`'s callback: the last argument, when it is a function, answered on the next tick. */
function answerLater(rest) {
  const last = rest[rest.length - 1];
  if (typeof last === 'function') process.nextTick(last, null, '', '');
}

if (log) {
  cp.spawn = (command, args) => {
    record(command, args);
    return inertChild();
  };
  cp.fork = (modulePath, args) => {
    record(modulePath, args);
    return inertChild();
  };
  cp.exec = (command, ...rest) => {
    record(command);
    answerLater(rest);
    return inertChild();
  };
  cp.execFile = (file, ...rest) => {
    record(file, rest[0]);
    answerLater(rest);
    return inertChild();
  };
  cp.spawnSync = (command, args) => {
    record(command, args);
    return { pid: 0, output: [null, '', ''], stdout: '', stderr: '', status: 0, signal: null };
  };
  cp.execSync = (command) => {
    record(command);
    return '';
  };
  cp.execFileSync = (file, args) => {
    record(file, args);
    return '';
  };
  // The product imports these by name: refresh the ES module bindings of the builtin, after all seven.
  syncBuiltinESMExports();
}
