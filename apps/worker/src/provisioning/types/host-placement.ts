export type HostProviderKey = 'mock' | 'hetzner' | 'digitalocean' | 'vultr' | 'aws';

export type HostPlacementCandidate = {
  provider: HostProviderKey;
  region: string;
  instanceType: string;
  priority: number;
  capacityProfile?: {
    cpuMillicores: number;
    memoryMb: number;
    diskGb: number;
  };
  constraints?: {
    architecture?: 'arm64' | 'x86_64';
    maxCostWeight?: number;
    tags?: string[];
  };
  source: 'primary-template' | 'fallback-policy' | 'manual-override';
};

export type HostProvisionPlan = {
  scaleEventId: string;
  candidates: HostPlacementCandidate[];
  strategy: 'single-candidate' | 'ordered-fallback';
};
