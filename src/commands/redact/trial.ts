import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { claimTrialKey, RedactApiError } from '../../utils/redact-api.js';
import { getRedactApiUrl, saveRedactApiKey } from '../../utils/redact-config.js';
import * as output from '../../utils/output.js';

export const trialCommand = new Command('trial')
  .description('Get a free, rate-limited redaction API key (no signup)')
  .action(async () => {
    const apiUrl = getRedactApiUrl();
    const spinner = ora('Requesting trial key…').start();
    try {
      const res = await claimTrialKey(apiUrl);
      saveRedactApiKey(res.apiKey);
      spinner.succeed('Trial key issued');
      console.log('');
      output.keyValue('Key', '••••••••' + res.apiKey.slice(-6));
      output.keyValue('Tier', res.tier);
      output.keyValue('Daily quota', String(res.quotaPerDay));
      output.keyValue('Resets at', res.resetsAt);
      console.log('');
      console.log(chalk.gray('Saved to CLI config. Try it:'));
      console.log(chalk.cyan('  echo "Patient John Doe, SSN 123-45-6789" | treza redact run --show-map'));
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      if (err instanceof RedactApiError && err.statusCode === 429) {
        console.log(chalk.yellow('\nTrial key rate limit reached. Try again later or contact sales for an upgrade.'));
      }
      process.exit(1);
    }
  });
