import { Command } from 'commander';
import ora from 'ora';
import prompts from 'prompts';
import chalk from 'chalk';
import { isConfigured } from '../utils/config.js';
import * as api from '../utils/api.js';
import * as output from '../utils/output.js';

export const enclaveCommand = new Command('enclave')
  .alias('enc')
  .description('Manage secure enclaves');

// Check configuration before running commands
function requireConfig(): void {
  if (!isConfigured()) {
    output.error('Not configured. Run: treza config init');
    process.exit(1);
  }
}

enclaveCommand
  .command('list')
  .alias('ls')
  .description('List all enclaves')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireConfig();
    const spinner = ora('Fetching enclaves...').start();

    try {
      const { enclaves } = await api.getEnclaves();
      spinner.stop();

      if (options.json) {
        output.json(enclaves);
        return;
      }

      if (enclaves.length === 0) {
        output.info('No enclaves found. Create one with: treza enclave create');
        return;
      }

      output.heading(`Enclaves (${enclaves.length})`);
      output.printTable(
        ['ID', 'Name', 'Status', 'Region', 'Provider', 'Created'],
        enclaves.map((e) => [
          e.id.slice(0, 16) + '...',
          e.name,
          output.statusColor(e.status),
          e.region,
          e.providerId,
          new Date(e.createdAt).toLocaleDateString(),
        ])
      );
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`API Error: ${err.message}`);
      } else {
        output.error(`Failed to fetch enclaves: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('get <id>')
  .description('Get enclave details')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireConfig();
    const spinner = ora('Fetching enclave...').start();

    try {
      const { enclave } = await api.getEnclave(id);
      spinner.stop();

      if (options.json) {
        output.json(enclave);
        return;
      }

      output.heading(enclave.name);
      output.keyValue('ID', enclave.id);
      output.keyValue('Status', output.statusColor(enclave.status));
      output.keyValue('Region', enclave.region);
      output.keyValue('Provider', enclave.providerId);
      output.keyValue('Description', enclave.description || '(none)');
      output.keyValue('Created', new Date(enclave.createdAt).toLocaleString());
      output.keyValue('Updated', new Date(enclave.updatedAt).toLocaleString());
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        if (err.statusCode === 404) {
          output.error(`Enclave not found: ${id}`);
        } else {
          output.error(`API Error: ${err.message}`);
        }
      } else {
        output.error(`Failed to fetch enclave: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('create')
  .description('Create a new enclave')
  .option('-n, --name <name>', 'Enclave name')
  .option('-d, --description <desc>', 'Enclave description')
  .option('-r, --region <region>', 'Deployment region')
  .option('-p, --provider <provider>', 'Provider ID', 'aws-nitro-enclave')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireConfig();

    let { name, description, region, provider } = options;

    // Interactive prompts if options not provided
    if (!name || !region) {
      // Fetch providers for region selection
      const spinner = ora('Loading providers...').start();
      let providers: api.Provider[] = [];
      try {
        const result = await api.getProviders();
        providers = result.providers;
        spinner.stop();
      } catch {
        spinner.stop();
        output.warn('Could not load providers, using defaults');
        providers = [{ id: 'aws-nitro-enclave', name: 'AWS Nitro', description: '', regions: ['us-east-1', 'us-west-2', 'eu-west-1'] }];
      }

      const selectedProvider = providers.find((p) => p.id === provider) || providers[0];

      const response = await prompts([
        {
          type: name ? null : 'text',
          name: 'name',
          message: 'Enclave name',
          validate: (v) => (v ? true : 'Name is required'),
        },
        {
          type: description ? null : 'text',
          name: 'description',
          message: 'Description (optional)',
        },
        {
          type: region ? null : 'select',
          name: 'region',
          message: 'Region',
          choices: selectedProvider.regions.map((r) => ({ title: r, value: r })),
        },
      ]);

      name = name || response.name;
      description = description || response.description;
      region = region || response.region;

      if (!name || !region) {
        output.error('Cancelled');
        process.exit(1);
      }
    }

    const spinner = ora('Creating enclave...').start();

    try {
      const { enclave } = await api.createEnclave({
        name,
        description: description || '',
        region,
        providerId: provider,
      });
      spinner.succeed('Enclave created!');

      if (options.json) {
        output.json(enclave);
        return;
      }

      console.log('');
      output.keyValue('ID', enclave.id);
      output.keyValue('Status', output.statusColor(enclave.status));
      output.keyValue('Region', enclave.region);
      console.log('');
      console.log(chalk.gray(`View details: treza enclave get ${enclave.id}`));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to create enclave: ${err.message}`);
      } else {
        output.error(`Failed to create enclave: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('pause <id>')
  .description('Pause an enclave')
  .action(async (id) => {
    requireConfig();
    const spinner = ora('Pausing enclave...').start();

    try {
      const { enclave, message } = await api.performEnclaveAction(id, 'pause');
      spinner.succeed(message || 'Enclave paused');
      output.keyValue('Status', output.statusColor(enclave.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to pause: ${err.message}`);
      } else {
        output.error(`Failed to pause: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('resume <id>')
  .description('Resume a paused enclave')
  .action(async (id) => {
    requireConfig();
    const spinner = ora('Resuming enclave...').start();

    try {
      const { enclave, message } = await api.performEnclaveAction(id, 'resume');
      spinner.succeed(message || 'Enclave resumed');
      output.keyValue('Status', output.statusColor(enclave.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to resume: ${err.message}`);
      } else {
        output.error(`Failed to resume: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('terminate <id>')
  .description('Terminate an enclave')
  .option('-f, --force', 'Skip confirmation')
  .action(async (id, options) => {
    requireConfig();

    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to terminate enclave ${id}? This cannot be undone.`,
        initial: false,
      });

      if (!response.confirm) {
        output.info('Cancelled');
        return;
      }
    }

    const spinner = ora('Terminating enclave...').start();

    try {
      const { enclave, message } = await api.performEnclaveAction(id, 'terminate');
      spinner.succeed(message || 'Enclave terminated');
      output.keyValue('Status', output.statusColor(enclave.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to terminate: ${err.message}`);
      } else {
        output.error(`Failed to terminate: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('delete <id>')
  .description('Delete a terminated enclave')
  .option('-f, --force', 'Skip confirmation')
  .action(async (id, options) => {
    requireConfig();

    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Delete enclave ${id}? This will remove all data.`,
        initial: false,
      });

      if (!response.confirm) {
        output.info('Cancelled');
        return;
      }
    }

    const spinner = ora('Deleting enclave...').start();

    try {
      const { message } = await api.deleteEnclave(id);
      spinner.succeed(message || 'Enclave deleted');
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to delete: ${err.message}`);
      } else {
        output.error(`Failed to delete: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('logs <id>')
  .description('View enclave logs')
  .option('-t, --type <type>', 'Log type: all, ecs, application, errors, lambda, stepfunctions', 'all')
  .option('-n, --limit <limit>', 'Number of log entries', '50')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireConfig();
    const spinner = ora('Fetching logs...').start();

    try {
      const { logs } = await api.getEnclaveLogs(id, options.type, parseInt(options.limit));
      spinner.stop();

      if (options.json) {
        output.json(logs);
        return;
      }

      const allLogs: Array<{ timestamp: number; message: string; source: string }> = [];
      
      for (const [source, entries] of Object.entries(logs)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            allLogs.push({
              timestamp: (entry as Record<string, unknown>).timestamp as number || Date.now(),
              message: (entry as Record<string, unknown>).message as string || '',
              source,
            });
          }
        }
      }

      if (allLogs.length === 0) {
        output.info('No logs found');
        return;
      }

      // Sort by timestamp
      allLogs.sort((a, b) => a.timestamp - b.timestamp);

      output.heading(`Logs (${allLogs.length} entries)`);
      for (const log of allLogs.slice(-parseInt(options.limit))) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const sourceColor = log.source === 'errors' ? chalk.red : chalk.cyan;
        console.log(
          chalk.gray(time) + ' ' + sourceColor(`[${log.source}]`) + ' ' + log.message
        );
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to fetch logs: ${err.message}`);
      } else {
        output.error(`Failed to fetch logs: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });
