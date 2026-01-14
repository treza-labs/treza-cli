import Conf from 'conf';

interface TrezaConfig {
  apiUrl: string;
  walletAddress: string;
  apiKey?: string;
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
