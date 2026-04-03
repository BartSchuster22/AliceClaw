import type { HostServerProvider } from '../../providers/host-server-provider.js';
import { HetznerHostServerProvider } from '../../providers/hetzner-host-server-provider.js';
import { MockHostServerProvider } from '../../providers/mock-host-server-provider.js';
import type { HostProviderKey } from '../types/host-placement.js';

export interface HostProviderRegistry {
  get(provider: HostProviderKey): HostServerProvider;
}

export function getHostProviderRegistry(): HostProviderRegistry {
  return {
    get(provider) {
      if (provider === 'mock') {
        return new MockHostServerProvider();
      }

      if (provider === 'hetzner') {
        return new HetznerHostServerProvider();
      }

      throw new Error(`Unsupported host provider: ${provider}`);
    },
  };
}
