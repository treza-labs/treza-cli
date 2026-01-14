import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as api from '../utils/api.js';
import * as output from '../utils/output.js';

export const kycCommand = new Command('kyc')
  .description('KYC proof verification commands');

kycCommand
  .command('verify <proofId>')
  .description('Verify a KYC proof')
  .option('--json', 'Output as JSON')
  .action(async (proofId, options) => {
    const spinner = ora('Verifying proof...').start();

    try {
      const result = await api.verifyProof(proofId);
      spinner.stop();

      if (options.json) {
        output.json(result);
        return;
      }

      if (result.isValid) {
        output.success('Proof is valid!');
      } else {
        output.error('Proof is invalid or expired');
      }

      console.log('');
      output.keyValue('Proof ID', result.proofId);
      output.keyValue('Valid', result.isValid ? chalk.green('Yes') : chalk.red('No'));
      output.keyValue('Chain Verified', result.chainVerified ? chalk.green('Yes') : chalk.gray('No'));
      output.keyValue('Verified At', new Date(result.verifiedAt).toLocaleString());
      output.keyValue('Expires At', new Date(result.expiresAt).toLocaleString());

      if (result.publicInputs && result.publicInputs.length > 0) {
        console.log('');
        output.heading('Public Inputs');
        result.publicInputs.forEach((input, i) => {
          output.keyValue(`Input ${i + 1}`, input.slice(0, 20) + '...');
        });
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        if (err.statusCode === 404) {
          output.error(`Proof not found: ${proofId}`);
        } else if (err.statusCode === 410) {
          output.error('Proof has expired');
        } else {
          output.error(`Verification failed: ${err.message}`);
        }
      } else {
        output.error(`Verification failed: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

kycCommand
  .command('get <proofId>')
  .description('Get proof details')
  .option('--json', 'Output as JSON')
  .action(async (proofId, options) => {
    const spinner = ora('Fetching proof...').start();

    try {
      const proof = await api.getProof(proofId);
      spinner.stop();

      if (options.json) {
        output.json(proof);
        return;
      }

      output.heading('Proof Details');
      output.keyValue('Proof ID', proof.proofId);
      output.keyValue('Algorithm', proof.algorithm);
      output.keyValue('Commitment', proof.commitment.slice(0, 16) + '...' + proof.commitment.slice(-8));
      output.keyValue('Verified At', new Date(proof.verifiedAt).toLocaleString());
      output.keyValue('Expires At', new Date(proof.expiresAt).toLocaleString());

      // Check if expired
      const now = new Date();
      const expiresAt = new Date(proof.expiresAt);
      if (expiresAt < now) {
        console.log('');
        output.warn('This proof has expired');
      } else {
        const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        console.log('');
        output.info(`Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
      }

      if (proof.publicInputs && proof.publicInputs.length > 0) {
        console.log('');
        output.heading('Public Inputs');
        proof.publicInputs.forEach((input, i) => {
          console.log(chalk.gray(`  ${i + 1}.`) + ` ${input}`);
        });
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        if (err.statusCode === 404) {
          output.error(`Proof not found: ${proofId}`);
        } else {
          output.error(`Failed to fetch proof: ${err.message}`);
        }
      } else {
        output.error(`Failed to fetch proof: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

kycCommand
  .command('status <proofId>')
  .description('Quick status check for a proof')
  .action(async (proofId) => {
    const spinner = ora('Checking status...').start();

    try {
      const result = await api.verifyProof(proofId);
      spinner.stop();

      const now = new Date();
      const expiresAt = new Date(result.expiresAt);
      const isExpired = expiresAt < now;

      if (isExpired) {
        console.log(chalk.red('✗') + ' ' + chalk.red('EXPIRED'));
      } else if (result.isValid) {
        console.log(chalk.green('✓') + ' ' + chalk.green('VALID'));
        if (result.chainVerified) {
          console.log(chalk.green('⛓') + ' ' + chalk.gray('Blockchain verified'));
        }
      } else {
        console.log(chalk.red('✗') + ' ' + chalk.red('INVALID'));
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        if (err.statusCode === 404) {
          console.log(chalk.gray('?') + ' ' + chalk.gray('NOT FOUND'));
        } else if (err.statusCode === 410) {
          console.log(chalk.red('✗') + ' ' + chalk.red('EXPIRED'));
        } else {
          output.error(err.message);
        }
      } else {
        output.error((err as Error).message);
      }
      process.exit(1);
    }
  });
