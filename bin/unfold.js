#!/usr/bin/env node
import { main } from '../dist/cli.js';
import { restoreTerminal } from '../dist/tui/restore.js';

function crash(err) {
  restoreTerminal();
  process.stderr.write(`\n[unfold] Unexpected error: ${err?.stack ?? err}\n`);
  process.stderr.write('[unfold] Please report it at https://github.com/faizm10/unfold/issues\n');
  process.exit(1);
}
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);

main(process.argv.slice(2)).then((code) => process.exit(code), crash);
