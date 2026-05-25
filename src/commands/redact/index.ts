import { Command } from 'commander';
import { runCommand } from './run.js';
import { proxyCommand } from './proxy.js';
import { logCommand } from './log.js';

export const redactCommand = new Command('redact')
  .description('Hardware-attested PII/PHI redaction (run, proxy, log)');

redactCommand.addCommand(runCommand);
redactCommand.addCommand(proxyCommand);
redactCommand.addCommand(logCommand);
