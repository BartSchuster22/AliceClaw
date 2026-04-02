import type { HostServerProvider } from './host-server-provider.js';
import { HetznerHostServerProvider } from './hetzner-host-server-provider.js';
import { MockHostServerProvider } from './mock-host-server-provider.js';

export function getHostServerProvider(): HostServerProvider {
  const provider = process.env.HOST_SERVER_PROVIDER ?? (process.env.NODE_ENV !== 'production' ? 'mock' : 'hetzner');

  if (provider === 'mock') {
    return new MockHostServerProvider();
  }

  if (provider === 'hetzner') {
    return new HetznerHostServerProvider();
  }

  throw new Error(`Unsupported HOST_SERVER_PROVIDER: ${provider}`);
}
