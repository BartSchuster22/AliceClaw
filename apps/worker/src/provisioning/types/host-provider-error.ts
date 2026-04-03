export type ProviderErrorCode =
  | 'capacity_unavailable'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'auth_failed'
  | 'invalid_region'
  | 'invalid_instance_type'
  | 'invalid_ssh_key'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'network_error'
  | 'unknown';

export type ProviderErrorClassification = {
  code: ProviderErrorCode;
  retryable: boolean;
  fallbackAllowed: boolean;
  rawMessage: string;
  providerStatusCode?: number;
  providerBodySnippet?: string;
};
