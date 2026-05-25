import { getRedactApiKey, getRedactApiUrl, setRedactApiKey as persistKey } from './config.js';

export { getRedactApiUrl } from './config.js';

export interface RedactCredentials {
  apiKey: string;
  apiUrl: string;
}

export class NoRedactKeyError extends Error {
  constructor() {
    super(
      'No redaction API key configured. Get a free trial key with:\n  treza redact trial\n\nOr set one explicitly:\n  treza config set redactApiKey <key>'
    );
    this.name = 'NoRedactKeyError';
  }
}

export interface RedactCredentialOptions {
  apiKey?: string;
}

/**
 * Resolve the redaction API credentials with the documented precedence:
 *   --api-key flag  >  TREZA_REDACT_API_KEY env var  >  config redactApiKey
 *
 * Throws NoRedactKeyError when no key is available anywhere. The thrown
 * error has a friendly multiline message that command handlers can print
 * directly to the user.
 */
export function resolveRedactCredentials(options: RedactCredentialOptions = {}): RedactCredentials {
  const apiKey = options.apiKey || process.env.TREZA_REDACT_API_KEY || getRedactApiKey();
  if (!apiKey) {
    throw new NoRedactKeyError();
  }
  return { apiKey, apiUrl: getRedactApiUrl() };
}

export function saveRedactApiKey(key: string): void {
  persistKey(key);
}
