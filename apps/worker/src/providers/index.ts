import type { HostServerProvider } from './host-server-provider.js';
import { getHostProviderRegistry } from '../provisioning/registry/host-provider-registry.js';

export function getHostServerProvider(): HostServerProvider {
  const provider = (process.env.HOST_SERVER_PROVIDER ??
    (process.env.NODE_ENV !== 'production' ? 'mock' : 'hetzner')) as 'mock' | 'hetzner';

  return getHostProviderRegistry().get(provider);
}
