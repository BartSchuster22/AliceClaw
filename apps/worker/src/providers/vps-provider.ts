export interface VpsProvider {
  createServer(params: {
    name: string;
    spec: { ram_gb: number; cpu: number; disk_gb: number; os_image: string };
    region: string;
    sshPublicKeys: string[];
    cloudInitScript: string;
  }): Promise<{ providerId: string; ip: string }>;

  getServerStatus(providerId: string): Promise<'starting' | 'running' | 'error'>;

  deleteServer(providerId: string): Promise<void>;
}
