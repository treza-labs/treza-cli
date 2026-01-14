import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as api from '../utils/api.js';
import * as output from '../utils/output.js';

export const providerCommand = new Command('provider')
  .description('List available enclave providers');

providerCommand
  .command('list')
  .alias('ls')
  .description('List all available providers')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching providers...').start();

    try {
      const { providers } = await api.getProviders();
      spinner.stop();

      if (options.json) {
        output.json(providers);
        return;
      }

      if (providers.length === 0) {
        output.info('No providers available');
        return;
      }

      output.heading(`Available Providers (${providers.length})`);
      
      for (const provider of providers) {
        console.log('');
        console.log(chalk.bold.cyan(provider.name) + chalk.gray(` (${provider.id})`));
        console.log(chalk.gray('  ' + provider.description));
        console.log(chalk.gray('  Regions: ') + provider.regions.join(', '));
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to fetch providers: ${err.message}`);
      } else {
        output.error(`Failed to fetch providers: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Make list the default command
providerCommand.action(async () => {
  await providerCommand.commands.find(c => c.name() === 'list')?.parseAsync([]);
});
