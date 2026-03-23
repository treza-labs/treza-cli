import { Command } from 'commander';
import * as fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import * as api from '../utils/api.js';
import * as output from '../utils/output.js';
import { getPiiProcessorEnclaveId, getComplianceMode } from '../utils/config.js';

export const piiCommand = new Command('pii').description('PII-TEE: ingest, retrieve, consent, audit');

piiCommand
  .command('submit')
  .description('Submit PII for KMS envelope encryption at the platform')
  .requiredOption('--file <path>', 'JSON file with { type, payload, consentGiven, metadata? }')
  .option('--enclave <id>', 'PII_PROCESSOR enclave id', getPiiProcessorEnclaveId())
  .action(async (opts) => {
    const spinner = ora('Submitting PII…').start();
    try {
      const raw = fs.readFileSync(opts.file, 'utf8');
      const doc = JSON.parse(raw) as Record<string, unknown>;
      if (!doc.type || !doc.payload) {
        spinner.fail('File must include type and payload');
        process.exit(1);
      }
      doc.consentGiven = doc.consentGiven ?? true;
      if (opts.enclave) doc.processorEnclaveId = opts.enclave;
      doc.metadata = { ...(doc.metadata as object), complianceMode: getComplianceMode() };
      const res = await api.piiIngest(doc);
      spinner.succeed('Stored');
      output.json(res);
    } catch (e) {
      spinner.fail((e as Error).message);
      process.exit(1);
    }
  });

piiCommand
  .command('retrieve')
  .description('Retrieve encrypted PII envelope')
  .requiredOption('--pii-id <id>', 'piiId')
  .requiredOption('--purpose <text>', 'Purpose matching consent recipient')
  .option('--enclave <id>', 'Route decrypt through PII_PROCESSOR enclave', getPiiProcessorEnclaveId())
  .action(async (opts) => {
    const spinner = ora('Retrieving…').start();
    try {
      const res = await api.piiRetrieve({
        piiId: opts.piiId,
        purpose: opts.purpose,
        processorEnclaveId: opts.enclave || undefined,
      });
      spinner.succeed('OK');
      output.json(res);
    } catch (e) {
      spinner.fail((e as Error).message);
      process.exit(1);
    }
  });

piiCommand
  .command('delete')
  .description('GDPR-style erasure request')
  .requiredOption('--pii-id <id>', 'piiId')
  .action(async (opts) => {
    const spinner = ora('Deleting…').start();
    try {
      const res = await api.piiDelete(opts.piiId);
      spinner.succeed('Scheduled erasure');
      output.json(res);
    } catch (e) {
      spinner.fail((e as Error).message);
      process.exit(1);
    }
  });

const consent = piiCommand.command('consent').description('Consent management');

consent
  .command('grant')
  .requiredOption('--data-type <t>', 'e.g. SSN')
  .requiredOption('--recipient <r>', 'Recipient id or 0x address or *')
  .action(async (opts) => {
    const spinner = ora('Granting consent…').start();
    try {
      const res = await api.piiConsentGrant({
        dataType: opts.dataType,
        recipient: opts.recipient,
      });
      spinner.succeed('Granted');
      output.json(res);
    } catch (e) {
      spinner.fail((e as Error).message);
      process.exit(1);
    }
  });

consent
  .command('revoke')
  .requiredOption('--consent-id <id>', 'consentId')
  .action(async (opts) => {
    const spinner = ora('Revoking…').start();
    try {
      const res = await api.piiConsentRevoke(opts.consentId);
      spinner.succeed('Revoked');
      output.json(res);
    } catch (e) {
      spinner.fail((e as Error).message);
      process.exit(1);
    }
  });

piiCommand
  .command('audit')
  .description('Fetch PII audit events for configured wallet')
  .option('--user-id <wallet>', 'Wallet / user id (defaults to config wallet)')
  .option('--start-date <iso>', 'Filter from date (client-side filter may apply)')
  .option('--limit <n>', 'Max rows', '100')
  .action(async (opts) => {
    const spinner = ora('Loading audit…').start();
    try {
      const res = (await api.piiAudit({
        wallet: opts.userId,
        startDate: opts.startDate,
        limit: opts.limit,
      })) as { events?: unknown[] };
      spinner.succeed(`Events: ${res.events?.length ?? 0}`);
      if (opts.startDate && res.events) {
        const cutoff = new Date(opts.startDate).getTime();
        res.events = res.events.filter((ev: unknown) => {
          const ts = (ev as { timestamp?: string })?.timestamp;
          return ts ? new Date(ts).getTime() >= cutoff : true;
        });
      }
      output.json(res);
    } catch (e) {
      spinner.fail((e as Error).message);
      process.exit(1);
    }
  });

piiCommand.hook('preAction', () => {
  if (!getComplianceMode()) return;
  if (process.env.TREZA_QUIET !== '1') {
    console.log(chalk.gray(`Compliance mode: ${getComplianceMode()}`));
  }
});
