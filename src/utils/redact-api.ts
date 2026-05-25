import { RedactCredentials } from './redact-config.js';

export interface RedactEntity {
  type: string;
  placeholder: string;
  start: number;
  end: number;
}

export interface RedactResult {
  redacted: string;
  entities: RedactEntity[];
  requestId: string;
  attestation?: AttestationSummary;
  modelVersion?: string;
  recognizerVersion?: string;
}

export interface AttestationSummary {
  enclaveId: string;
  region: string;
  pcr0?: string;
  modelVersion?: string;
  recognizerVersion?: string;
}

export interface TrialKeyResponse {
  apiKey: string;
  tier: 'trial';
  quotaPerDay: number;
  resetsAt: string;
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

async function request<T>(
  creds: RedactCredentials,
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.apiKey}`,
    },
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

export async function claimTrialKey(apiUrl: string): Promise<TrialKeyResponse> {
  const base = apiUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/redact/trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
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
    throw new RedactApiError(err || `Trial endpoint ${res.status}`, res.status, parsed);
  }
  return parsed as TrialKeyResponse;
}

export async function redactText(creds: RedactCredentials, text: string): Promise<RedactResult> {
  return request<RedactResult>(creds, '/api/redact/run', {
    method: 'POST',
    body: { text },
  });
}

export async function fetchAttestation(creds: RedactCredentials): Promise<AttestationSummary> {
  return request<AttestationSummary>(creds, '/api/redact/attest', { method: 'GET' });
}

export async function getAuditLog(
  creds: RedactCredentials,
  params: { limit?: number; since?: string } = {},
): Promise<AuditListResponse> {
  const query: Record<string, string> = {};
  if (params.limit) query.limit = String(params.limit);
  if (params.since) query.since = params.since;
  return request<AuditListResponse>(creds, '/api/redact/log', { method: 'GET', query });
}

/**
 * Forward an OpenAI-shaped chat-completion request through the control plane.
 * Returns the raw upstream response body and (optionally) a rehydration map
 * the proxy can use to substitute originals back in client-side.
 */
export async function chatCompletionProxy(
  creds: RedactCredentials,
  body: Record<string, unknown>,
  modelKey: string,
  options: { rehydrate?: boolean } = {},
): Promise<{
  status: number;
  body: unknown;
  rehydrationMap?: Record<string, string>;
  requestId?: string;
}> {
  const base = creds.apiUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/redact/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.apiKey}`,
      'x-model-key': modelKey,
      'x-treza-rehydrate': options.rehydrate ? '1' : '0',
    },
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
