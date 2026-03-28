import { randomUUID } from 'node:crypto';

import type { VpsProvider } from './vps-provider.js';

const statusCalls = new Map<string, number>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIpOctet() {
  return Math.floor(Math.random() * (254 - 2 + 1)) + 2;
}

export class MockVpsAdapter implements VpsProvider {
  async createServer(): Promise<{ providerId: string; ip: string }> {
    await delay(3000);

    return {
      providerId: `mock-${randomUUID()}`,
      ip: `192.168.1.${randomIpOctet()}`,
    };
  }

  async getServerStatus(providerId: string): Promise<'starting' | 'running' | 'error'> {
    const calls = (statusCalls.get(providerId) ?? 0) + 1;
    statusCalls.set(providerId, calls);

    if (calls === 1) {
      return 'starting';
    }

    return 'running';
  }

  async deleteServer(providerId: string): Promise<void> {
    console.log(`mock delete ${providerId}`);
  }
}
