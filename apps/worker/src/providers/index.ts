import type { VpsProvider } from './vps-provider.js';
import { MockVpsAdapter } from './mock-vps-adapter.js';

export function getVpsProvider(): VpsProvider {
  if (process.env.NODE_ENV !== 'production') {
    return new MockVpsAdapter();
  }

  throw new Error('HetznerAdapter is not implemented yet. Production VPS provisioning is unavailable until Phase 13.');
}
