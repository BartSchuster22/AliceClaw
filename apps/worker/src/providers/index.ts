import type { HostServerProvider } from './host-server-provider.js';
import { MockHostServerProvider } from './mock-host-server-provider.js';

export function getHostServerProvider(): HostServerProvider {
  if (process.env.NODE_ENV !== 'production') {
    return new MockHostServerProvider();
  }

  throw new Error('Host server adapter is not implemented yet. Production host provisioning is unavailable until A1 is completed.');
}
