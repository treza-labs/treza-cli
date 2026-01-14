import { getApiUrl, getWalletAddress, getApiKey } from './config.js';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const baseUrl = getApiUrl();
  const apiKey = getApiKey();

  let url = `${baseUrl}${endpoint}`;

  // Add query params
  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    throw new ApiError(
      (data.error as string) || 'API request failed',
      response.status,
      data
    );
  }

  return data as T;
}

// Enclave API
export interface Enclave {
  id: string;
  name: string;
  description: string;
  status: string;
  region: string;
  providerId: string;
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
}

export async function getEnclaves(): Promise<{ enclaves: Enclave[] }> {
  const wallet = getWalletAddress();
  return apiRequest('/api/enclaves', { params: { wallet } });
}

export async function getEnclave(id: string): Promise<{ enclave: Enclave }> {
  return apiRequest(`/api/enclaves/${id}`);
}

export async function createEnclave(data: {
  name: string;
  description: string;
  region: string;
  providerId: string;
  providerConfig?: Record<string, unknown>;
}): Promise<{ enclave: Enclave }> {
  const wallet = getWalletAddress();
  return apiRequest('/api/enclaves', {
    method: 'POST',
    body: { ...data, walletAddress: wallet },
  });
}

export async function performEnclaveAction(
  id: string,
  action: 'pause' | 'resume' | 'terminate'
): Promise<{ enclave: Enclave; message: string }> {
  const wallet = getWalletAddress();
  return apiRequest(`/api/enclaves/${id}`, {
    method: 'PATCH',
    body: { action, walletAddress: wallet },
  });
}

export async function deleteEnclave(id: string): Promise<{ message: string }> {
  const wallet = getWalletAddress();
  return apiRequest(`/api/enclaves/${id}`, {
    method: 'DELETE',
    params: { wallet },
  });
}

export async function getEnclaveLogs(
  id: string,
  type?: string,
  limit?: number
): Promise<{ logs: Record<string, unknown[]> }> {
  const params: Record<string, string> = {};
  if (type) params.type = type;
  if (limit) params.limit = String(limit);
  return apiRequest(`/api/enclaves/${id}/logs`, { params });
}

// Provider API
export interface Provider {
  id: string;
  name: string;
  description: string;
  regions: string[];
}

export async function getProviders(): Promise<{ providers: Provider[] }> {
  return apiRequest('/api/providers');
}

// KYC API
export interface ProofDetails {
  proofId: string;
  commitment: string;
  publicInputs: string[];
  algorithm: string;
  verifiedAt: string;
  expiresAt: string;
}

export interface VerificationResult {
  proofId: string;
  isValid: boolean;
  publicInputs: string[];
  verifiedAt: string;
  chainVerified: boolean;
  expiresAt: string;
}

export async function getProof(proofId: string): Promise<ProofDetails> {
  return apiRequest(`/api/kyc/proof/${proofId}`);
}

export async function verifyProof(proofId: string): Promise<VerificationResult> {
  return apiRequest(`/api/kyc/proof/${proofId}/verify`);
}

// Task API
export interface Task {
  id: string;
  name: string;
  description: string;
  enclaveId: string;
  status: string;
  schedule: string;
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
  lastRun?: string;
}

export async function getTasks(enclaveId?: string): Promise<{ tasks: Task[] }> {
  const wallet = getWalletAddress();
  const params: Record<string, string> = { wallet };
  if (enclaveId) params.enclave = enclaveId;
  return apiRequest('/api/tasks', { params });
}

export async function createTask(data: {
  name: string;
  description: string;
  enclaveId: string;
  schedule: string;
}): Promise<{ task: Task }> {
  const wallet = getWalletAddress();
  return apiRequest('/api/tasks', {
    method: 'POST',
    body: { ...data, walletAddress: wallet },
  });
}

export async function deleteTask(id: string): Promise<{ message: string }> {
  const wallet = getWalletAddress();
  return apiRequest('/api/tasks', {
    method: 'DELETE',
    params: { id, wallet },
  });
}
