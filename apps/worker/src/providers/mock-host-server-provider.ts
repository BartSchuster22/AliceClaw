import { randomUUID } from 'node:crypto';

import type { HostServerProvider } from './host-server-provider.js';

const statusCalls = new Map<string, number>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIpOctet() {
  return Math.floor(Math.random() * (254 - 2 + 1)) + 2;
}

export class MockHostServerProvider implements HostServerProvider {
  async provisionHostServer(): Promise<{ providerId: string; ipAddress: string }> {
    await delay(3000);

    return {
      providerId: `mock-${randomUUID()}`,
      ipAddress: `192.168.1.${randomIpOctet()}`,
    };
  }

  async getHostServerStatus(providerId: string): Promise<'starting' | 'running' | 'error'> {
    const calls = (statusCalls.get(providerId) ?? 0) + 1;
    statusCalls.set(providerId, calls);

    if (calls === 1) {
      return 'starting';
    }

    return 'running';
  }

  async deleteHostServer(providerId: string): Promise<void> {
    console.log(`mock delete ${providerId}`);
  }
}
