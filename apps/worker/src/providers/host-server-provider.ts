export type HostProviderLifecycleStatus = 'creating' | 'starting' | 'running' | 'deleting' | 'deleted' | 'error' | 'unknown';

export type ProviderActionInfo = {
  id?: string;
  command?: string;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type HostServerDetails = {
  providerId: string;
  exists: boolean;
  lifecycleStatus: HostProviderLifecycleStatus;
  ipAddress: string | null;
  rawStatus?: string | null;
  providerMetadata?: Record<string, unknown>;
  action?: ProviderActionInfo | null;
};

export type ProviderSshKeyRef = {
  id?: string;
  name?: string;
  publicKey: string;
};

export type HostServerDeleteResult = {
  accepted: boolean;
  alreadyMissing?: boolean;
  rawStatus?: string | null;
  action?: ProviderActionInfo | null;
};

export interface HostServerProvider {
  ensureSshKeyRefs(params: { sshPublicKeys: string[]; keyNamePrefix?: string }): Promise<ProviderSshKeyRef[]>;

  provisionHostServer(params: {
    name: string;
    instanceType: string;
    region: string;
    sshKeyRefs: ProviderSshKeyRef[];
    cloudInitScript: string;
  }): Promise<HostServerDetails>;

  getHostServerDetails(providerId: string): Promise<HostServerDetails>;

  deleteHostServer(providerId: string): Promise<HostServerDeleteResult>;
}
