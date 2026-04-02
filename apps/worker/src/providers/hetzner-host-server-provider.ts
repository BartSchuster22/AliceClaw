import { createHash } from 'node:crypto';

import type { HostServerDetails, HostServerProvider, ProviderSshKeyRef } from './host-server-provider.js';

type HetznerServerStatus = 'initializing' | 'starting' | 'running' | 'off' | 'deleting' | 'unknown';

function mapHetznerStatus(status: string | undefined): HostServerDetails['lifecycleStatus'] {
  switch (status) {
    case 'initializing':
      return 'creating';
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'deleting':
      return 'deleting';
    case 'off':
      return 'error';
    default:
      // Conservative by design: if Hetzner introduces or returns an undocumented
      // lifecycle state, PSI should not silently treat it as healthy.
      return 'unknown';
  }
}

export class HetznerHostServerProvider implements HostServerProvider {
  private buildKeyName(publicKey: string, prefix = 'psi-host-key') {
    const suffix = createHash('sha256').update(publicKey).digest('hex').slice(0, 12);
    return `${prefix}-${suffix}`;
  }

  async ensureSshKeyRefs(params: { sshPublicKeys: string[]; keyNamePrefix?: string }): Promise<ProviderSshKeyRef[]> {
    const payload = await this.request('/ssh_keys');
    const existingKeys = Array.isArray(payload.ssh_keys) ? payload.ssh_keys : [];

    const resolved: ProviderSshKeyRef[] = [];

    for (const publicKey of params.sshPublicKeys) {
      const existing = existingKeys.find((entry: any) => entry.public_key === publicKey);
      if (existing) {
        resolved.push({
          id: String(existing.id),
          name: existing.name,
          publicKey,
        });
        continue;
      }

      const created = await this.request('/ssh_keys', {
        method: 'POST',
        body: JSON.stringify({
          name: this.buildKeyName(publicKey, params.keyNamePrefix ?? 'psi-host-key'),
          public_key: publicKey,
          labels: {
            project: 'psi',
            managed_by: 'openclaw',
          },
        }),
      });

      const sshKey = created.ssh_key;
      resolved.push({
        id: String(sshKey.id),
        name: sshKey.name,
        publicKey,
      });
    }

    return resolved;
  }

  private getToken() {
    const token = process.env.HETZNER_API_TOKEN;
    if (!token) {
      throw new Error('HETZNER_API_TOKEN is required');
    }
    return token;
  }

  private getBaseUrl() {
    return process.env.HETZNER_API_URL ?? 'https://api.hetzner.cloud/v1';
  }

  private async request(path: string, init?: RequestInit) {
    const response = await fetch(`${this.getBaseUrl()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.getToken()}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Hetzner API request failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }

  async provisionHostServer(params: {
    name: string;
    instanceType: string;
    region: string;
    sshKeyRefs: ProviderSshKeyRef[];
    cloudInitScript: string;
  }): Promise<HostServerDetails> {
    const body = {
      name: params.name,
      server_type: params.instanceType,
      location: params.region,
      user_data: params.cloudInitScript,
      start_after_create: true,
      ssh_keys: params.sshKeyRefs.map((key) => key.id ?? key.name).filter(Boolean),
      labels: {
        project: 'psi',
        managed_by: 'openclaw',
      },
    };

    const payload = await this.request('/servers', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const server = payload.server;
    return {
      providerId: String(server.id),
      exists: true,
      lifecycleStatus: mapHetznerStatus(server.status as HetznerServerStatus),
      ipAddress: server.public_net?.ipv4?.ip ?? null,
      rawStatus: server.status ?? null,
      providerMetadata: {
        location: server.datacenter?.location?.name ?? null,
        serverType: server.server_type?.name ?? null,
        datacenter: server.datacenter?.name ?? null,
        labels: server.labels ?? null,
      },
    };
  }

  async getHostServerDetails(providerId: string): Promise<HostServerDetails> {
    try {
      const payload = await this.request(`/servers/${providerId}`);
      const server = payload.server;
      return {
        providerId,
        exists: true,
        lifecycleStatus: mapHetznerStatus(server.status as HetznerServerStatus),
        ipAddress: server.public_net?.ipv4?.ip ?? null,
        rawStatus: server.status ?? null,
        providerMetadata: {
          location: server.datacenter?.location?.name ?? null,
          serverType: server.server_type?.name ?? null,
          datacenter: server.datacenter?.name ?? null,
          labels: server.labels ?? null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404')) {
        return {
          providerId,
          exists: false,
          lifecycleStatus: 'deleted',
          ipAddress: null,
          rawStatus: 'not_found',
        };
      }
      throw error;
    }
  }

  async deleteHostServer(providerId: string) {
    try {
      const payload = await this.request(`/servers/${providerId}`, {
        method: 'DELETE',
      });
      return {
        accepted: true,
        actionId: payload.action?.id ? String(payload.action.id) : undefined,
        rawStatus: payload.action?.status ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404')) {
        return { accepted: true, alreadyMissing: true, rawStatus: 'not_found' };
      }
      throw error;
    }
  }
}
