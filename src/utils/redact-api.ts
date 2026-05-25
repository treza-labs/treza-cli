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
 * Forward an OpenAI-shaped chat-completion request through the control plane.
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
    body: JSON.stringify(body),
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
