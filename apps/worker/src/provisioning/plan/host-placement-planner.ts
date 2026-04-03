import type { serverTemplates } from '@psi/db/schema';

import type { HostProvisionPlan } from '../types/host-placement.js';

export async function buildSingleCandidateHostProvisionPlan(params: {
  scaleEventId: string;
  activeTemplate: typeof serverTemplates.$inferSelect;
}): Promise<HostProvisionPlan> {
  return {
    scaleEventId: params.scaleEventId,
    strategy: 'single-candidate',
    candidates: [
      {
        provider: params.activeTemplate.provider as 'mock' | 'hetzner',
        region: params.activeTemplate.region,
        instanceType: params.activeTemplate.instanceType,
        priority: 1,
        capacityProfile: {
          cpuMillicores: params.activeTemplate.expectedCpuMillicores,
          memoryMb: params.activeTemplate.expectedMemoryMb,
          diskGb: params.activeTemplate.expectedDiskGb,
        },
        source: 'primary-template',
      },
    ],
  };
}
