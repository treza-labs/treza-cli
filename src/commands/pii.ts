import { Command } from 'commander';
import * as fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import * as api from '../utils/api.js';
import { ApiError } from '../utils/api.js';
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
  .description('Query workflow PII access events (which fields were present, allowed, stripped, and any violations)')
  .option('--user-id <wallet>', 'Wallet / account id (defaults to config wallet)')
  .option('--workflow-id <id>', 'Only events for this workflow')
  .option('--violations', 'Only events where PII flowed into a step that declared requiresPII: []', false)
  .option('--start-date <iso>', 'Only events at/after this timestamp (ISO 8601)')
  .option('--limit <n>', 'Max rows', '100')
  .option('--json', 'Emit the raw { summary, events } JSON', false)
  .action(async (opts) => {
    const spinner = opts.json ? null : ora('Loading audit…').start();
    try {
      const res = await api.piiAudit({
        wallet: opts.userId,
        workflowId: opts.workflowId,
        violations: opts.violations,
        startDate: opts.startDate,
        limit: opts.limit,
      });

      const events = res.events ?? [];
      const summary = res.summary ?? {
        total: events.length,
        violations: events.filter((e) => e.hadViolation).length,
        workflows: [...new Set(events.map((e) => e.workflowId))],
      };

      spinner?.succeed(
        `${summary.total} event(s) · ${summary.violations} violation(s) · ${summary.workflows.length} workflow(s)`,
      );

      if (opts.json) {
        output.json(res);
        return;
      }

      if (events.length === 0) {
        output.info('No PII access events match this query.');
        return;
      }

      const rows = events.map((e) => [
        e.timestamp,
        e.workflowId,
        e.stepName || e.stepId,
        (e.piiFieldsPresent ?? []).join(',') || '-',
        (e.piiFieldsStripped ?? []).join(',') || '-',
        e.hadViolation ? chalk.red('⚠ yes') : 'no',
      ]);
      output.printTable(
        ['Timestamp', 'Workflow', 'Step', 'Present', 'Stripped', 'Violation'],
        rows,
        { truncate: 48 },
      );

      if (summary.violations > 0) {
        output.warn(
          `${summary.violations} violation(s): PII reached a step that declared requiresPII: []. Re-run with --violations to isolate them.`,
        );
      }
    } catch (e) {
      spinner?.fail((e as Error).message);
      if (e instanceof ApiError && (e.statusCode === 401 || e.statusCode === 403)) {
        console.error(
          chalk.yellow(
            'This endpoint needs an API key with the pii:audit scope, and the wallet must match the key owner. Contact your Treza account team.',
          ),
        );
      }
      process.exit(1);
    }
  });

piiCommand.hook('preAction', () => {
  if (!getComplianceMode()) return;
  if (process.env.TREZA_QUIET !== '1') {
    console.log(chalk.gray(`Compliance mode: ${getComplianceMode()}`));
  }
});
