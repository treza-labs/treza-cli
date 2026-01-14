import { Command } from 'commander';
import ora from 'ora';
import prompts from 'prompts';
import chalk from 'chalk';
import { isConfigured } from '../utils/config.js';
import * as api from '../utils/api.js';
import * as output from '../utils/output.js';

export const taskCommand = new Command('task')
  .description('Manage scheduled tasks');

function requireConfig(): void {
  if (!isConfigured()) {
    output.error('Not configured. Run: treza config init');
    process.exit(1);
  }
}

taskCommand
  .command('list')
  .alias('ls')
  .description('List all tasks')
  .option('-e, --enclave <id>', 'Filter by enclave ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireConfig();
    const spinner = ora('Fetching tasks...').start();

    try {
      const { tasks } = await api.getTasks(options.enclave);
      spinner.stop();

      if (options.json) {
        output.json(tasks);
        return;
      }

      if (tasks.length === 0) {
        output.info('No tasks found. Create one with: treza task create');
        return;
      }

      output.heading(`Tasks (${tasks.length})`);
      output.printTable(
        ['ID', 'Name', 'Status', 'Schedule', 'Enclave', 'Last Run'],
        tasks.map((t) => [
          t.id.slice(0, 12) + '...',
          t.name,
          output.statusColor(t.status),
          t.schedule,
          t.enclaveId.slice(0, 12) + '...',
          t.lastRun ? new Date(t.lastRun).toLocaleString() : 'Never',
        ])
      );
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to fetch tasks: ${err.message}`);
      } else {
        output.error(`Failed to fetch tasks: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

taskCommand
  .command('create')
  .description('Create a new scheduled task')
  .option('-n, --name <name>', 'Task name')
  .option('-d, --description <desc>', 'Task description')
  .option('-e, --enclave <id>', 'Enclave ID')
  .option('-s, --schedule <cron>', 'Cron schedule (e.g., "0 * * * *")')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireConfig();

    let { name, description, enclave, schedule } = options;

    // Interactive prompts
    if (!name || !enclave || !schedule) {
      // Fetch enclaves for selection
      const spinner = ora('Loading enclaves...').start();
      let enclaves: api.Enclave[] = [];
      try {
        const result = await api.getEnclaves();
        enclaves = result.enclaves.filter((e) => e.status === 'DEPLOYED');
        spinner.stop();
      } catch {
        spinner.stop();
        output.warn('Could not load enclaves');
      }

      if (enclaves.length === 0 && !enclave) {
        output.error('No deployed enclaves available. Create one first: treza enclave create');
        process.exit(1);
      }

      const response = await prompts([
        {
          type: name ? null : 'text',
          name: 'name',
          message: 'Task name',
          validate: (v) => (v ? true : 'Name is required'),
        },
        {
          type: description ? null : 'text',
          name: 'description',
          message: 'Description (optional)',
        },
        {
          type: enclave ? null : 'select',
          name: 'enclave',
          message: 'Target enclave',
          choices: enclaves.map((e) => ({
            title: `${e.name} (${e.id.slice(0, 12)}...)`,
            value: e.id,
          })),
        },
        {
          type: schedule ? null : 'select',
          name: 'schedule',
          message: 'Schedule',
          choices: [
            { title: 'Every minute', value: '* * * * *' },
            { title: 'Every 5 minutes', value: '*/5 * * * *' },
            { title: 'Every hour', value: '0 * * * *' },
            { title: 'Every 6 hours', value: '0 */6 * * *' },
            { title: 'Daily at midnight', value: '0 0 * * *' },
            { title: 'Daily at 9am', value: '0 9 * * *' },
            { title: 'Weekly (Sunday midnight)', value: '0 0 * * 0' },
            { title: 'Custom', value: 'custom' },
          ],
        },
        {
          type: (prev) => (prev === 'custom' ? 'text' : null),
          name: 'customSchedule',
          message: 'Enter cron expression',
          initial: '0 * * * *',
        },
      ]);

      name = name || response.name;
      description = description || response.description;
      enclave = enclave || response.enclave;
      schedule = schedule || response.customSchedule || response.schedule;

      if (!name || !enclave || !schedule) {
        output.error('Cancelled');
        process.exit(1);
      }
    }

    const spinner = ora('Creating task...').start();

    try {
      const { task } = await api.createTask({
        name,
        description: description || '',
        enclaveId: enclave,
        schedule,
      });
      spinner.succeed('Task created!');

      if (options.json) {
        output.json(task);
        return;
      }

      console.log('');
      output.keyValue('ID', task.id);
      output.keyValue('Schedule', task.schedule);
      output.keyValue('Status', output.statusColor(task.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to create task: ${err.message}`);
      } else {
        output.error(`Failed to create task: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

taskCommand
  .command('delete <id>')
  .description('Delete a task')
  .option('-f, --force', 'Skip confirmation')
  .action(async (id, options) => {
    requireConfig();

    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Delete task ${id}?`,
        initial: false,
      });

      if (!response.confirm) {
        output.info('Cancelled');
        return;
      }
    }

    const spinner = ora('Deleting task...').start();

    try {
      await api.deleteTask(id);
      spinner.succeed('Task deleted');
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

// Schedule helper command
taskCommand
  .command('cron')
  .description('Show common cron schedule examples')
  .action(() => {
    output.heading('Cron Schedule Examples');
    console.log('');
    console.log(chalk.cyan('  * * * * *     ') + chalk.gray('Every minute'));
    console.log(chalk.cyan('  */5 * * * *   ') + chalk.gray('Every 5 minutes'));
    console.log(chalk.cyan('  0 * * * *     ') + chalk.gray('Every hour'));
    console.log(chalk.cyan('  0 */6 * * *   ') + chalk.gray('Every 6 hours'));
    console.log(chalk.cyan('  0 0 * * *     ') + chalk.gray('Daily at midnight'));
    console.log(chalk.cyan('  0 9 * * *     ') + chalk.gray('Daily at 9:00 AM'));
    console.log(chalk.cyan('  0 0 * * 0     ') + chalk.gray('Weekly on Sunday'));
    console.log(chalk.cyan('  0 0 1 * *     ') + chalk.gray('Monthly on the 1st'));
    console.log('');
    console.log(chalk.gray('  Format: minute hour day month weekday'));
    console.log(chalk.gray('  Use * for "every", */N for "every Nth"'));
  });
