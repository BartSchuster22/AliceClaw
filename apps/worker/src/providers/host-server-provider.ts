export interface HostServerProvider {
  provisionHostServer(params: {
    name: string;
    instanceType: string;
    region: string;
    sshPublicKeys: string[];
    cloudInitScript: string;
  }): Promise<{ providerId: string; ipAddress: string }>;

  getHostServerStatus(providerId: string): Promise<'starting' | 'running' | 'error'>;

  deleteHostServer(providerId: string): Promise<void>;
}
