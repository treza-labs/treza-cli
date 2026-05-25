import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { getAuditLog, RedactApiError, MissingCredentialsError } from '../../utils/redact-api.js';
import * as output from '../../utils/output.js';

interface LogOptions {
  limit?: string;
  json?: boolean;
  since?: string;
  apiKey?: string;
}

export const logCommand = new Command('log')
  .description('View the redaction audit log (compliance proof — counts only, no originals)')
  .option('--limit <n>', 'Number of entries to show', '20')
  .option('--since <ts>', 'Only entries after timestamp (ISO 8601)')
  .option('--json', 'Emit results as a JSON array', false)
  .option('--api-key <key>', 'Override configured API key')
  .action(async (options: LogOptions) => {
    const spinner = options.json ? null : ora('Loading audit log…').start();
    try {
      const res = await getAuditLog({
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        since: options.since,
        apiKey: options.apiKey,
      });
      spinner?.succeed(`${res.entries.length} entries`);

      if (options.json) {
        process.stdout.write(JSON.stringify(res.entries, null, 2) + '\n');
        return;
      }

      if (res.entries.length === 0) {
        output.info('No audit entries yet. Run `treza redact run` or `treza redact proxy` to generate one.');
        return;
      }

      const rows = res.entries.map((e) => {
        const counts = Object.entries(e.entityCountsByType)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ');
        return [e.ts, e.source, counts || '-', e.requestId.slice(0, 12)];
      });
      output.printTable(['Timestamp', 'Source', 'Entities', 'Request ID'], rows, { truncate: 60 });
    } catch (err) {
      spinner?.fail(err instanceof Error ? err.message : String(err));
      if (err instanceof MissingCredentialsError) {
        console.error(chalk.red(err.message));
      } else if (err instanceof RedactApiError && err.statusCode === 403) {
        console.error(chalk.yellow('Your API key is missing redact:log permission. Contact your Treza account team.'));
      }
      process.exit(1);
    }
  });
