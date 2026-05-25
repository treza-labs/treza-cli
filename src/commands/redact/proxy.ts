import { Command } from 'commander';
import * as http from 'http';
import chalk from 'chalk';
import {
  chatCompletionProxy,
  fetchAttestation,
  RedactApiError,
  MissingCredentialsError,
} from '../../utils/redact-api.js';

interface ProxyOptions {
  port?: string;
  modelKey?: string;
  rehydrate?: boolean;
  apiKey?: string;
}

const DEFAULT_PORT = 8717;

function applyRehydration(value: unknown, map: Record<string, string>): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const [placeholder, original] of Object.entries(map)) {
      out = out.split(placeholder).join(original);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyRehydration(v, map));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = applyRehydration(v, map);
    }
    return result;
  }
  return value;
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export const proxyCommand = new Command('proxy')
  .description('Run a local OpenAI-compatible endpoint that redacts in-flight via the TEE')
  .option('-p, --port <n>', 'Local port to listen on', String(DEFAULT_PORT))
  .option('--model-key <key>', 'Caller OpenAI key for the upstream call (defaults to OPENAI_API_KEY)')
  .option('--rehydrate', 'Substitute placeholders back to originals in responses (client-side only)', false)
  .option('--api-key <key>', 'Override configured Treza API key')
  .action(async (options: ProxyOptions) => {
    const modelKey = options.modelKey || process.env.OPENAI_API_KEY;
    if (!modelKey) {
      console.error(
        chalk.red(
          'Missing upstream model key. Set OPENAI_API_KEY in your environment or pass --model-key.',
        ),
      );
      process.exit(1);
    }

    const port = options.port ? parseInt(options.port, 10) : DEFAULT_PORT;
    if (!Number.isFinite(port) || port <= 0) {
      console.error(chalk.red(`Invalid --port value: ${options.port}`));
      process.exit(1);
    }

    let attest;
    try {
      attest = await fetchAttestation({ apiKey: options.apiKey });
    } catch (err) {
      if (err instanceof MissingCredentialsError) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
      console.error(chalk.red(`Failed to fetch attestation: ${(err as Error).message}`));
      if (err instanceof RedactApiError && err.statusCode === 403) {
        console.error(chalk.yellow('Your API key is missing redact permissions. Contact your Treza account team.'));
      }
      process.exit(1);
    }

    const server = http.createServer(async (req, res) => {
      const startedAt = Date.now();
      const url = req.url || '/';

      if (req.method === 'GET' && (url === '/' || url === '/v1/health' || url === '/healthz')) {
        send(res, 200, { ok: true, mode: 'tee', attestation: attest });
        return;
      }

      if (req.method !== 'POST' || !url.startsWith('/v1/chat/completions')) {
        send(res, 404, { error: 'Not found. Try POST /v1/chat/completions' });
        return;
      }

      const rawBody = await readRequestBody(req);
      let body: Record<string, unknown>;
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        send(res, 400, { error: 'Invalid JSON in request body' });
        return;
      }

      if (body.stream && options.rehydrate) {
        send(res, 400, {
          error:
            'Streaming responses are not supported with --rehydrate yet. Disable streaming or run the proxy without --rehydrate.',
        });
        return;
      }

      try {
        const upstream = await chatCompletionProxy(body, modelKey, {
          rehydrate: options.rehydrate,
          apiKey: options.apiKey,
        });

        let payload = upstream.body;
        if (options.rehydrate && upstream.rehydrationMap) {
          payload = applyRehydration(payload, upstream.rehydrationMap);
        }

        if (upstream.requestId) res.setHeader('x-treza-request-id', upstream.requestId);
        res.setHeader('x-treza-mode', 'tee');
        send(res, upstream.status, payload);

        const ms = Date.now() - startedAt;
        console.log(
          chalk.gray(
            `[${new Date().toISOString()}] POST /v1/chat/completions → ${upstream.status} (${ms}ms)`,
          ),
        );
      } catch (err) {
        const status = err instanceof RedactApiError ? err.statusCode || 502 : 502;
        const message =
          err instanceof Error
            ? err.message
            : 'Redaction upstream failed; payload was NOT forwarded to the model provider.';
        send(res, status, {
          error: 'redaction_failed',
          message,
          note: 'No data was forwarded upstream. The proxy fails closed when the TEE step errors.',
        });
        console.error(chalk.red(`[${new Date().toISOString()}] redaction failed: ${message}`));
      }
    });

    server.listen(port, () => {
      const base = `http://localhost:${port}/v1`;
      console.log('');
      console.log(chalk.bold('Treza redaction proxy running.'));
      console.log(chalk.gray(`  Base URL:  ${base}`));
      console.log(chalk.gray(`  Upstream:  api.openai.com`));
      console.log(
        chalk.gray(
          `  TEE:       attested (enclave ${attest?.enclaveId || 'unknown'}, ${attest?.region || 'unknown'})`,
        ),
      );
      if (options.rehydrate) {
        console.log(chalk.yellow('  Rehydrate: ON (placeholders replaced client-side in responses)'));
      }
      console.log('');
      console.log(chalk.bold('Point your client here:'));
      console.log(chalk.cyan(`  openai.base_url = "${base}"`));
      console.log('');
      console.log(chalk.gray('Logging redactions to: treza redact log'));
      console.log('');
    });

    const shutdown = () => {
      console.log('\n' + chalk.gray('Shutting down proxy…'));
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
