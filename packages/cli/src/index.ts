import { buildProgram, fail } from './program';

// Exit cleanly when a downstream reader closes the pipe early (e.g.
// `claudinho table | head`). Without this, the write to a closed stdout raises
// an unhandled EPIPE 'error' event and Node dumps a raw stack trace.
function handlePipeError(stream: NodeJS.WriteStream): void {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}
handlePipeError(process.stdout);
handlePipeError(process.stderr);

buildProgram().parseAsync().catch(fail);
