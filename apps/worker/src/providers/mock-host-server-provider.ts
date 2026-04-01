import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { HostServerProvider } from './host-server-provider.js';

type MockProviderMode = 'success' | 'fail_provision' | 'error_on_status' | 'stuck_starting' | 'fail_delete';

type MockHostRecord = {
  mode: MockProviderMode;
  ipAddress: string;
  statusCalls: number;
  deleted: boolean;
};

const hostRecords = new Map<string, MockHostRecord>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIpOctet() {
  return Math.floor(Math.random() * (254 - 2 + 1)) + 2;
}

function readScenarioOverrides() {
  try {
    const raw = readFileSync('/workspace/.openclaw/mock-host-provider.json', 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getMode(): MockProviderMode {
  const overrides = readScenarioOverrides();
  const rawMode = String(overrides.mode ?? process.env.MOCK_HOST_PROVIDER_MODE ?? 'success').trim().toLowerCase();
  const allowedModes: MockProviderMode[] = ['success', 'fail_provision', 'error_on_status', 'stuck_starting', 'fail_delete'];
  return allowedModes.includes(rawMode as MockProviderMode) ? (rawMode as MockProviderMode) : 'success';
}

function getProvisionDelayMs() {
  const overrides = readScenarioOverrides();
  return Number(overrides.provisionDelayMs ?? process.env.MOCK_HOST_PROVISION_DELAY_MS ?? 3000);
}

function getReadyAfterCalls() {
  const overrides = readScenarioOverrides();
  return Math.max(1, Number(overrides.readyAfterCalls ?? process.env.MOCK_HOST_READY_AFTER_CALLS ?? 2));
}

function getIpBasePrefix() {
  const overrides = readScenarioOverrides();
  return String(overrides.ipBase ?? process.env.MOCK_HOST_IP_BASE ?? '192.168.1');
}

function isVerbose() {
  const overrides = readScenarioOverrides();
  return String(overrides.verbose ?? process.env.MOCK_HOST_LOG_VERBOSE ?? 'false') === 'true';
}

function log(message: string, payload?: Record<string, unknown>) {
  if (!isVerbose() && !message.includes('forced')) {
    return;
  }

  console.log('[mock-host-provider]', message, payload ?? {});
}

export class MockHostServerProvider implements HostServerProvider {
  async provisionHostServer(): Promise<{ providerId: string; ipAddress: string }> {
    const mode = getMode();
    await delay(getProvisionDelayMs());

    if (mode === 'fail_provision') {
      log('forced provision failure');
      throw new Error('MockHostProvider: forced provision failure');
    }

    const providerId = `mock-${randomUUID()}`;
    const ipAddress = `${getIpBasePrefix()}.${randomIpOctet()}`;
    hostRecords.set(providerId, {
      mode,
      ipAddress,
      statusCalls: 0,
      deleted: false,
    });

    log('provisioned mock host', { providerId, mode, ipAddress });

    return {
      providerId,
      ipAddress,
    };
  }

  async getHostServerStatus(providerId: string): Promise<'starting' | 'running' | 'error'> {
    const record = hostRecords.get(providerId);
    if (!record || record.deleted) {
      log('status requested for unknown/deleted host', { providerId });
      return 'error';
    }

    record.statusCalls += 1;
    hostRecords.set(providerId, record);

    if (record.mode === 'error_on_status' && record.statusCalls >= getReadyAfterCalls()) {
      log('forced provider error on status', { providerId, statusCalls: record.statusCalls });
      return 'error';
    }

    if (record.mode === 'stuck_starting') {
      log('stuck in starting state', { providerId, statusCalls: record.statusCalls });
      return 'starting';
    }

    if (record.statusCalls < getReadyAfterCalls()) {
      log('still starting', { providerId, statusCalls: record.statusCalls });
      return 'starting';
    }

    log('host reached running state', { providerId, statusCalls: record.statusCalls });
    return 'running';
  }

  async deleteHostServer(providerId: string): Promise<void> {
    const record = hostRecords.get(providerId);
    if (!record) {
      log('delete requested for unknown host', { providerId });
      return;
    }

    if (record.mode === 'fail_delete') {
      log('forced delete failure', { providerId });
      throw new Error('MockHostProvider: forced delete failure');
    }

    record.deleted = true;
    hostRecords.set(providerId, record);
    log('deleted mock host', { providerId });
  }
}
