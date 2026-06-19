/**
 * Thin HTTP client for the Treza redaction control plane.
 *
 * Uses the existing CLI auth scheme — Bearer API key + `x-treza-wallet`
 * header — exactly like the `treza pii` commands. No separate trial /
 * wallet-free flow. Customers receive an API key with `redact:*`
 * permissions during manual onboarding.
 */
import { getApiKey, getWalletAddress, getApiUrl } from './config.js';

export interface RedactEntity {
  type: string;
  placeholder: string;
  start: number;
  end: number;
}

export interface AttestationSummary {
  enclaveId: string;
  region: string;
  pcr0?: string;
  modelVersion?: string;
  recognizerVersion?: string;
  attested?: boolean;
}

export interface RedactResult {
  redacted: string;
  entities: RedactEntity[];
  requestId: string;
  attestation?: AttestationSummary;
  modelVersion?: string;
  recognizerVersion?: string;
}

export interface AuditEntry {
  ts: string;
  requestId: string;
  source: 'run' | 'proxy';
  entityCountsByType: Record<string, number>;
  attestationRef: string;
  modelVersion?: string;
  recognizerVersion?: string;
}

export interface AuditListResponse {
  entries: AuditEntry[];
  nextCursor?: string;
}

export class RedactApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'RedactApiError';
  }
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      'No API key and/or wallet address configured.\n' +
        'Run `treza config init` to set both, or contact your Treza account team for onboarding.',
    );
    this.name = 'MissingCredentialsError';
  }
}

interface Creds {
  apiKey: string;
  walletAddress: string;
  apiUrl: string;
}

export function resolveCreds(override?: { apiKey?: string }): Creds {
  const apiKey = override?.apiKey || process.env.TREZA_API_KEY || getApiKey();
  const walletAddress = getWalletAddress();
  if (!apiKey || !walletAddress) {
    throw new MissingCredentialsError();
  }
  return { apiKey, walletAddress, apiUrl: getApiUrl() };
}

function authHeaders(creds: Creds, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${creds.apiKey}`,
    'x-treza-wallet': creds.walletAddress,
    ...extra,
  };
}

async function request<T>(
  creds: Creds,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const base = creds.apiUrl.replace(/\/$/, '');
  let url = `${base}${path}`;
  if (init.query) {
    const qs = new URLSearchParams(init.query).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: authHeaders(creds),
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const err = (parsed as { error?: string })?.error;
    throw new RedactApiError(err || `Redaction API ${res.status}`, res.status, parsed);
  }
  return parsed as T;
}

export async function redactText(text: string, override?: { apiKey?: string }): Promise<RedactResult> {
  const creds = resolveCreds(override);
  return request<RedactResult>(creds, '/api/redact/run', {
    method: 'POST',
    body: { text },
  });
}

export async function fetchAttestation(override?: { apiKey?: string }): Promise<AttestationSummary> {
  const creds = resolveCreds(override);
  return request<AttestationSummary>(creds, '/api/redact/attest', { method: 'GET' });
}

export async function getAuditLog(
  params: { limit?: number; since?: string; apiKey?: string } = {},
): Promise<AuditListResponse> {
  const creds = resolveCreds({ apiKey: params.apiKey });
  const query: Record<string, string> = {};
  if (params.limit) query.limit = String(params.limit);
  if (params.since) query.since = params.since;
  return request<AuditListResponse>(creds, '/api/redact/log', { method: 'GET', query });
}

/**
 * Forward an OpenAI-shaped chat-completion request through the control plane
 * and buffer the full (non-streaming) response.
 */
export async function chatCompletionProxy(
  body: Record<string, unknown>,
  modelKey: string,
  options: { rehydrate?: boolean; apiKey?: string } = {},
): Promise<{
  status: number;
  body: unknown;
  rehydrationMap?: Record<string, string>;
  requestId?: string;
}> {
  const creds = resolveCreds({ apiKey: options.apiKey });
  const base = creds.apiUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/redact/chat/completions`, {
    method: 'POST',
    headers: authHeaders(creds, {
      'x-model-key': modelKey,
      'x-treza-rehydrate': options.rehydrate ? '1' : '0',
    }),
    // Buffered path always asks upstream for a non-streaming response.
    body: JSON.stringify({ ...body, stream: false }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const err = (parsed as { error?: string })?.error;
    throw new RedactApiError(err || `Proxy upstream ${res.status}`, res.status, parsed);
  }
  let rehydrationMap: Record<string, string> | undefined;
  const headerMap = res.headers.get('x-treza-rehydration');
  if (headerMap && options.rehydrate) {
    try {
      rehydrationMap = JSON.parse(headerMap);
    } catch {
      rehydrationMap = undefined;
    }
  }
  return {
    status: res.status,
    body: parsed,
    rehydrationMap,
    requestId: res.headers.get('x-treza-request-id') || undefined,
  };
}

export interface ChatCompletionStream {
  status: number;
  /** Raw upstream SSE stream when the upstream actually streamed, else null. */
  stream: ReadableStream<Uint8Array> | null;
  /** Set when the upstream returned a non-SSE body (e.g. a JSON error) instead. */
  body?: unknown;
  contentType: string;
  /**
   * Placeholder → original map sent in the `x-treza-rehydration` header. Known
   * entirely from the request-side redaction, so it is available before the
   * first token. Only populated when `rehydrate` was requested.
   */
  rehydrationMap?: Record<string, string>;
  requestId?: string;
}

/**
 * Streaming variant of {@link chatCompletionProxy}. Asks the control plane for
 * an SSE stream (`stream: true`) and returns the raw upstream byte stream so the
 * caller can pipe it straight to its own client. The proxy never rewrites the
 * response body — placeholders are rehydrated client-side (see
 * `applyStreamRehydration`) using the `x-treza-rehydration` map.
 *
 * Fails closed: if the request-side redaction errors the control plane returns a
 * non-2xx JSON body and this throws a {@link RedactApiError} before any bytes
 * reach the caller — nothing was forwarded upstream.
 */
export async function chatCompletionProxyStream(
  body: Record<string, unknown>,
  modelKey: string,
  options: { rehydrate?: boolean; apiKey?: string } = {},
): Promise<ChatCompletionStream> {
  const creds = resolveCreds({ apiKey: options.apiKey });
  const base = creds.apiUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/redact/chat/completions`, {
    method: 'POST',
    headers: authHeaders(creds, {
      'x-model-key': modelKey,
      'x-treza-rehydrate': options.rehydrate ? '1' : '0',
    }),
    body: JSON.stringify({ ...body, stream: true }),
  });

  const contentType = res.headers.get('content-type') || '';
  const requestId = res.headers.get('x-treza-request-id') || undefined;

  let rehydrationMap: Record<string, string> | undefined;
  const headerMap = res.headers.get('x-treza-rehydration');
  if (headerMap && options.rehydrate) {
    try {
      rehydrationMap = JSON.parse(headerMap);
    } catch {
      rehydrationMap = undefined;
    }
  }

  // Non-SSE response (error, or upstream fell back to a buffered body): read it
  // out and surface it as a normal JSON body so the caller forwards it verbatim.
  if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const err = (parsed as { error?: string })?.error;
      throw new RedactApiError(err || `Proxy upstream ${res.status}`, res.status, parsed);
    }
    return { status: res.status, stream: null, body: parsed, contentType, rehydrationMap, requestId };
  }

  return { status: res.status, stream: res.body, contentType, rehydrationMap, requestId };
}

const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

/**
 * Stateful rehydrator for streamed text. A placeholder such as `[EMAIL_1]` can
 * be split across SSE chunks, so we rehydrate against accumulated text rather
 * than individual deltas: any trailing fragment that could still grow into a
 * placeholder (an unclosed `[…`) is held back and prepended to the next delta.
 *
 * Returns the rehydrated, safe-to-emit text for this delta (possibly empty).
 * Call {@link StreamRehydrator.flush} once the stream ends to drain the tail.
 */
export class StreamRehydrator {
  private carry = '';
  constructor(private readonly map: Record<string, string>) {}

  push(delta: string): string {
    const combined = this.carry + delta;
    // Hold back from the last unclosed `[` — it may be the start of a placeholder
    // whose closing `]` arrives in a later chunk.
    const lastOpen = combined.lastIndexOf('[');
    let safe: string;
    if (lastOpen !== -1 && combined.indexOf(']', lastOpen) === -1) {
      safe = combined.slice(0, lastOpen);
      this.carry = combined.slice(lastOpen);
    } else {
      safe = combined;
      this.carry = '';
    }
    return this.rehydrate(safe);
  }

  flush(): string {
    const out = this.rehydrate(this.carry);
    this.carry = '';
    return out;
  }

  private rehydrate(text: string): string {
    if (!text) return text;
    return text.replace(PLACEHOLDER_RE, (m) => this.map[m] ?? m);
  }
}
