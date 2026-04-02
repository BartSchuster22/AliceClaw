export type HostProviderLifecycleStatus = 'creating' | 'starting' | 'running' | 'deleting' | 'deleted' | 'error' | 'unknown';

export type HostServerDetails = {
  providerId: string;
  exists: boolean;
  lifecycleStatus: HostProviderLifecycleStatus;
  ipAddress: string | null;
  rawStatus?: string | null;
  providerMetadata?: Record<string, unknown>;
};

export type ProviderSshKeyRef = {
  id?: string;
  name?: string;
  publicKey: string;
};

export type HostServerDeleteResult = {
  accepted: boolean;
  alreadyMissing?: boolean;
  actionId?: string;
  rawStatus?: string | null;
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
