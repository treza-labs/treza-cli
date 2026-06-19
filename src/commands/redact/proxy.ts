import { Command } from 'commander';
import * as http from 'http';
import chalk from 'chalk';
import {
  chatCompletionProxy,
  chatCompletionProxyStream,
  StreamRehydrator,
  ChatCompletionStream,
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

interface StreamChunkChoice {
  index?: number;
  finish_reason?: string | null;
  delta?: { content?: string | null; [k: string]: unknown };
}

/**
 * Pipe an upstream SSE chat-completion stream to the local client.
 *
 * Without `--rehydrate` the raw bytes are forwarded untouched (the privacy
 * default — placeholders stay in the output). With `--rehydrate` we decode the
 * SSE, swap placeholders back to originals across chunk boundaries via
 * {@link StreamRehydrator}, and re-emit valid SSE.
 */
async function streamChatCompletion(
  res: http.ServerResponse,
  upstream: ChatCompletionStream,
  rehydrate: boolean,
): Promise<void> {
  // Upstream returned a non-SSE body (e.g. a JSON error) despite stream:true —
  // forward it verbatim as a normal response.
  if (!upstream.stream) {
    if (upstream.requestId) res.setHeader('x-treza-request-id', upstream.requestId);
    res.setHeader('x-treza-mode', 'tee');
    send(res, upstream.status, upstream.body ?? { error: 'empty upstream response' });
    return;
  }

  res.statusCode = upstream.status;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (upstream.requestId) res.setHeader('x-treza-request-id', upstream.requestId);
  res.setHeader('x-treza-mode', 'tee');

  const reader = upstream.stream.getReader();
  res.on('close', () => { void reader.cancel().catch(() => {}); });

  const map = rehydrate ? upstream.rehydrationMap : undefined;

  // Fast path: nothing to rehydrate — forward the SSE bytes unchanged.
  if (!map || Object.keys(map).length === 0) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    return;
  }

  // Rehydrating path: one rehydrator per choice index so split placeholders are
  // resolved against accumulated text, never an individual delta.
  const decoder = new TextDecoder();
  const rehydrators = new Map<number, StreamRehydrator>();
  const rehydratorFor = (i: number): StreamRehydrator => {
    let r = rehydrators.get(i);
    if (!r) { r = new StreamRehydrator(map); rehydrators.set(i, r); }
    return r;
  };

  const handleLine = (line: string): void => {
    if (!line.startsWith('data:')) {
      // Event separators (blank lines) and comments pass through untouched.
      res.write(line + '\n');
      return;
    }
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      // Drain any held-back tail (safety net — finish chunks already flush).
      for (const [i, r] of rehydrators) {
        const tail = r.flush();
        if (tail) {
          res.write(`data: ${JSON.stringify({ choices: [{ index: i, delta: { content: tail } }] })}\n\n`);
        }
      }
      res.write('data: [DONE]\n');
      return;
    }
    let chunk: { choices?: StreamChunkChoice[] };
    try {
      chunk = JSON.parse(payload);
    } catch {
      res.write(line + '\n');
      return;
    }
    for (const choice of chunk.choices ?? []) {
      const r = rehydratorFor(typeof choice.index === 'number' ? choice.index : 0);
      const delta = choice.delta;
      const hadContent = delta != null && typeof delta.content === 'string';
      let piece = hadContent ? r.push(delta!.content as string) : '';
      if (choice.finish_reason != null) piece += r.flush();
      if (delta != null && (hadContent || piece)) delta.content = piece;
    }
    res.write(`data: ${JSON.stringify(chunk)}\n`);
  };

  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) handleLine(buf);
  res.end();
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

      const wantsStream = body.stream === true;

      try {
        if (wantsStream) {
          const upstream = await chatCompletionProxyStream(body, modelKey, {
            rehydrate: options.rehydrate,
            apiKey: options.apiKey,
          });
          await streamChatCompletion(res, upstream, !!options.rehydrate);

          const ms = Date.now() - startedAt;
          console.log(
            chalk.gray(
              `[${new Date().toISOString()}] POST /v1/chat/completions (stream) → ${upstream.status} (${ms}ms)`,
            ),
          );
          return;
        }

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
        // If a stream was already in flight the headers (and some bytes) are
        // gone — just close the connection. Redaction itself happens before the
        // first byte, so a mid-stream failure never leaks un-redacted data.
        if (res.headersSent) {
          res.end();
        } else {
          send(res, status, {
            error: 'redaction_failed',
            message,
            note: 'No data was forwarded upstream. The proxy fails closed when the TEE step errors.',
          });
        }
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
      console.log(chalk.gray('  Streaming: supported (stream:true) — buffered and SSE both proxied'));
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
