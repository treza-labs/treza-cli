import Conf from 'conf';

interface TrezaConfig {
  apiUrl: string;
  walletAddress: string;
  apiKey?: string;
  /** Default Nitro PII_PROCESSOR enclave id for `treza pii` commands */
  piiProcessorEnclaveId?: string;
  /** Compliance labeling for client-side tooling (gdpr | ccpa | hipaa | off) */
  complianceMode?: string;
  /** API key for the redaction service (wallet-free) */
  redactApiKey?: string;
  /** Redaction service endpoint (defaults to the same host as apiUrl) */
  redactApiUrl?: string;
}

const schema = {
  apiUrl: {
    type: 'string' as const,
    default: 'https://app.trezalabs.com',
  },
  walletAddress: {
    type: 'string' as const,
    default: '',
  },
  apiKey: {
    type: 'string' as const,
    default: '',
  },
  piiProcessorEnclaveId: {
    type: 'string' as const,
    default: '',
  },
  complianceMode: {
    type: 'string' as const,
    default: 'off',
  },
  redactApiKey: {
    type: 'string' as const,
    default: '',
  },
  redactApiUrl: {
    type: 'string' as const,
    default: 'https://app.trezalabs.com',
  },
};

let configInstance: Conf<TrezaConfig> | null = null;

export function getConfig(): Conf<TrezaConfig> {
  if (!configInstance) {
    configInstance = new Conf<TrezaConfig>({
      projectName: 'treza-cli',
      schema,
    });
  }
  return configInstance;
}

export function isConfigured(): boolean {
  const config = getConfig();
  return !!(config.get('walletAddress'));
}

export function getApiUrl(): string {
  return getConfig().get('apiUrl') || 'https://app.trezalabs.com';
}

export function getWalletAddress(): string {
  return getConfig().get('walletAddress') || '';
}

export function getApiKey(): string | undefined {
  return getConfig().get('apiKey') || undefined;
}

export function getPiiProcessorEnclaveId(): string | undefined {
  const v = getConfig().get('piiProcessorEnclaveId');
  return v ? String(v) : undefined;
}

export function getComplianceMode(): string {
  return getConfig().get('complianceMode') || 'off';
}

export function getRedactApiKey(): string | undefined {
  return getConfig().get('redactApiKey') || undefined;
}

export function setRedactApiKey(key: string): void {
  getConfig().set('redactApiKey', key);
}

export function getRedactApiUrl(): string {
  return getConfig().get('redactApiUrl') || getConfig().get('apiUrl') || 'https://app.trezalabs.com';
}
