import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import { getConfig, isConfigured } from '../utils/config.js';
import * as output from '../utils/output.js';

export const configCommand = new Command('config')
  .description('Manage CLI configuration');

configCommand
  .command('init')
  .description('Initialize CLI configuration')
  .action(async () => {
    console.log(chalk.bold('\n🔧 Treza CLI Configuration\n'));

    const config = getConfig();
    const currentWallet = config.get('walletAddress');
    const currentUrl = config.get('apiUrl');

    const response = await prompts([
      {
        type: 'text',
        name: 'walletAddress',
        message: 'Your wallet address (Ethereum/Solana)',
        initial: currentWallet,
        validate: (value) => {
          if (!value) return 'Wallet address is required';
          if (!value.startsWith('0x') && value.length < 32) {
            return 'Invalid wallet address format';
          }
          return true;
        },
      },
      {
        type: 'select',
        name: 'apiUrl',
        message: 'API Environment',
        choices: [
          { title: 'Production (app.trezalabs.com)', value: 'https://app.trezalabs.com' },
          { title: 'Local Development (localhost:3000)', value: 'http://localhost:3000' },
          { title: 'Custom', value: 'custom' },
        ],
        initial: currentUrl === 'http://localhost:3000' ? 1 : 0,
      },
      {
        type: (prev) => prev === 'custom' ? 'text' : null,
        name: 'customApiUrl',
        message: 'Custom API URL',
        validate: (value) => {
          try {
            new URL(value);
            return true;
          } catch {
            return 'Invalid URL';
          }
        },
      },
      {
        type: 'text',
        name: 'apiKey',
        message: 'API Key (optional, press Enter to skip)',
        initial: config.get('apiKey') || '',
      },
    ]);

    if (!response.walletAddress) {
      output.error('Configuration cancelled');
      return;
    }

    const apiUrl = response.customApiUrl || response.apiUrl;

    config.set('walletAddress', response.walletAddress);
    config.set('apiUrl', apiUrl);
    if (response.apiKey) {
      config.set('apiKey', response.apiKey);
    }

    console.log('');
    output.success('Configuration saved!');
    console.log('');
    output.keyValue('Wallet', response.walletAddress);
    output.keyValue('API URL', apiUrl);
    if (response.apiKey) {
      output.keyValue('API Key', '••••••••' + response.apiKey.slice(-4));
    }
    console.log('');
    console.log(chalk.gray(`Config stored at: ${config.path}`));
  });

configCommand
  .command('show')
  .description('Show current configuration')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = getConfig();

    if (options.json) {
      output.json({
        walletAddress: config.get('walletAddress'),
        apiUrl: config.get('apiUrl'),
        hasApiKey: !!config.get('apiKey'),
        configPath: config.path,
      });
      return;
    }

    if (!isConfigured()) {
      output.warn('Not configured. Run: treza config init');
      return;
    }

    output.heading('Current Configuration');
    output.keyValue('Wallet Address', config.get('walletAddress') || '(not set)');
    output.keyValue('API URL', config.get('apiUrl') || 'https://app.trezalabs.com');
    output.keyValue('API Key', config.get('apiKey') ? '••••••••' + config.get('apiKey')!.slice(-4) : '(not set)');
    console.log('');
    console.log(chalk.gray(`Config file: ${config.path}`));
  });

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    const config = getConfig();
    const validKeys = ['walletAddress', 'apiUrl', 'apiKey'];

    if (!validKeys.includes(key)) {
      output.error(`Invalid key: ${key}. Valid keys: ${validKeys.join(', ')}`);
      process.exit(1);
    }

    config.set(key as keyof typeof config.store, value);
    output.success(`Set ${key} = ${key === 'apiKey' ? '••••••••' : value}`);
  });

configCommand
  .command('clear')
  .description('Clear all configuration')
  .action(async () => {
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to clear all configuration?',
      initial: false,
    });

    if (response.confirm) {
      const config = getConfig();
      config.clear();
      output.success('Configuration cleared');
    } else {
      output.info('Cancelled');
    }
  });

configCommand
  .command('path')
  .description('Show configuration file path')
  .action(() => {
    const config = getConfig();
    console.log(config.path);
  });
