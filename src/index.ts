#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { configCommand } from './commands/config.js';
import { enclaveCommand } from './commands/enclave.js';
import { kycCommand } from './commands/kyc.js';
import { providerCommand } from './commands/provider.js';
import { taskCommand } from './commands/task.js';
import { piiCommand } from './commands/pii.js';
import { getConfig } from './utils/config.js';

const VERSION = '1.0.0';

const program = new Command();

// ASCII art banner
const banner = `
${chalk.hex('#6366f1')('╔════════════════════════════════════════╗')}
${chalk.hex('#6366f1')('║')}  ${chalk.bold.white('TREZA CLI')} ${chalk.gray('v' + VERSION)}                    ${chalk.hex('#6366f1')('║')}
${chalk.hex('#6366f1')('║')}  ${chalk.gray('Privacy infrastructure for finance')}    ${chalk.hex('#6366f1')('║')}
${chalk.hex('#6366f1')('╚════════════════════════════════════════╝')}
`;

program
  .name('treza')
  .description('Command-line interface for the Treza platform')
  .version(VERSION, '-v, --version', 'Display version number')
  .hook('preAction', (thisCommand) => {
    // Show banner for main commands (not for help/version)
    const commandName = thisCommand.args[0];
    if (commandName && !['help', 'config'].includes(commandName)) {
      const config = getConfig();
      if (!config.get('apiUrl')) {
        console.log(chalk.yellow('\n⚠️  Not configured. Run: treza config init\n'));
      }
    }
  });

// Add commands
program.addCommand(configCommand);
program.addCommand(enclaveCommand);
program.addCommand(kycCommand);
program.addCommand(providerCommand);
program.addCommand(taskCommand);
program.addCommand(piiCommand);

// Custom help
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ treza config init                    # Configure CLI');
  console.log('  $ treza enclave list                   # List your enclaves');
  console.log('  $ treza enclave create --name "Bot"    # Create an enclave');
  console.log('  $ treza kyc verify <proof-id>          # Verify a KYC proof');
  console.log('');
  console.log('Documentation:');
  console.log(`  ${chalk.cyan('https://docs.treza.xyz/cli')}`);
});

// Show banner on no args
if (process.argv.length === 2) {
  console.log(banner);
  program.outputHelp();
} else {
  program.parse(process.argv);
}
