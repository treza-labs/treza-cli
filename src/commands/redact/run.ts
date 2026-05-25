import { Command } from 'commander';
import * as fs from 'fs';
import chalk from 'chalk';
import {
  redactText,
  RedactResult,
  RedactApiError,
  MissingCredentialsError,
} from '../../utils/redact-api.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface RunOptions {
  showMap?: boolean;
  json?: boolean;
  out?: string;
  apiKey?: string;
  local?: boolean;
}

function formatMap(result: RedactResult): string {
  const lines = [`Redacted ${result.entities.length} entities:`];
  for (const e of result.entities) {
    const pad = e.placeholder.padEnd(12);
    lines.push(`  ${pad} chars ${e.start}-${e.end}`);
  }
  return lines.join('\n');
}

function modeBanner(mode: 'tee' | 'local', attest?: { enclaveId?: string; region?: string }): string {
  if (mode === 'tee') {
    const id = attest?.enclaveId || 'unknown';
    const region = attest?.region || 'unknown';
    return chalk.gray(`Mode: tee (attested, enclave ${id}, region ${region})`);
  }
  return chalk.yellow('Mode: local (NOT ATTESTED, no audit log)');
}

export const runCommand = new Command('run')
  .description('Redact PII/PHI from a file or stdin')
  .argument('[file]', 'File to redact (omit to read from stdin)')
  .option('--show-map', 'Also print the entity map (to stderr unless --json)', false)
  .option('--json', 'Emit { redacted, entities } as a single JSON object on stdout', false)
  .option('--out <file>', 'Write redacted text to a file instead of stdout')
  .option('--api-key <key>', 'Override configured API key (TEE mode only)')
  .option('--local', 'Run redaction in-process (NOT ATTESTED, no audit log)', false)
  .action(async (file: string | undefined, options: RunOptions) => {
    let input: string;
    try {
      if (file) {
        input = fs.readFileSync(file, 'utf8');
      } else {
        input = await readStdin();
      }
    } catch (err) {
      console.error(chalk.red(`Error reading input: ${(err as Error).message}`));
      process.exit(1);
    }

    if (!input || !input.trim()) {
      console.error(chalk.red('No input provided. Pipe text via stdin or pass a file path.'));
      process.exit(1);
    }

    let result: RedactResult;
    let bannerAttest: { enclaveId?: string; region?: string } | undefined;

    try {
      if (options.local) {
        const { redactTextLocal } = await import('../../utils/redact-local.js');
        result = await redactTextLocal(input);
      } else {
        result = await redactText(input, { apiKey: options.apiKey });
        bannerAttest = result.attestation
          ? { enclaveId: result.attestation.enclaveId, region: result.attestation.region }
          : undefined;
      }
    } catch (err) {
      if (err instanceof MissingCredentialsError) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
      if (err instanceof RedactApiError) {
        console.error(chalk.red(`Redaction failed: ${err.message}`));
        if (err.statusCode === 401) {
          console.error(chalk.yellow('Your API key may be invalid or your wallet header may not match the key owner.'));
        } else if (err.statusCode === 403) {
          console.error(chalk.yellow('Your API key is missing redact:run permission. Contact your Treza account team.'));
        }
        process.exit(1);
      }
      console.error(chalk.red(`Redaction failed: ${(err as Error).message}`));
      console.error(chalk.gray('Re-run with `--local` to use the on-device engine (NOT ATTESTED).'));
      process.exit(1);
    }

    if (options.json) {
      const payload = {
        redacted: result.redacted,
        entities: result.entities,
        mode: options.local ? 'local' : 'tee',
        attestation: result.attestation,
        modelVersion: result.modelVersion,
        recognizerVersion: result.recognizerVersion,
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      return;
    }

    if (options.out) {
      fs.writeFileSync(options.out, result.redacted, 'utf8');
      console.error(chalk.green(`Wrote redacted output to ${options.out}`));
    } else {
      process.stdout.write(result.redacted);
      if (!result.redacted.endsWith('\n')) process.stdout.write('\n');
    }

    if (options.showMap) {
      process.stderr.write('\n' + modeBanner(options.local ? 'local' : 'tee', bannerAttest) + '\n');
      process.stderr.write(formatMap(result) + '\n');
    }
  });
