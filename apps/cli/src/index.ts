#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { stopCommand } from './commands/stop.js';
import { doctorCommand } from './commands/doctor.js';
import { logsCommand } from './commands/logs.js';

const program = new Command();

program
  .name('loopy')
  .description('Local CLI for Loop Engineering — reads a GitHub Projects board and dispatches work to opencode')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(runCommand);
program.addCommand(statusCommand);
program.addCommand(stopCommand);
program.addCommand(doctorCommand);
program.addCommand(logsCommand);

program.parse();