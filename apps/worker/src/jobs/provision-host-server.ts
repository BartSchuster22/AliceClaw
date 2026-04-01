import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { hostServers, serverScaleEvents, serverTemplates } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getHostServerProvider } from '../providers/index.js';

export type ProvisionHostServerJobPayload = {
  scaleEventId: string;
};

export type ProvisionHostServerWorkerRuntime = {
  worker: Worker<ProvisionHostServerJobPayload>;
  close: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHostCloudInit(params: { sshPublicKeys: string[]; prePullImages: string[] }) {
  const authorizedKeys = params.sshPublicKeys.map((key) => `      - ${key}`).join('\n');
  const prePullCommands = params.prePullImages.filter(Boolean).map((image) => `docker pull ${image}`);
  const portRangeStart = Number(process.env.HOST_AGENT_PORT_RANGE_START ?? 3000);
  const portRangeEnd = Number(process.env.HOST_AGENT_PORT_RANGE_END ?? 3500);

  return `#cloud-config
package_update: true
package_upgrade: true
packages:
  - docker.io
  - docker-compose-plugin
  - fail2ban
  - ufw
users:
  - name: openclaw
    groups: docker, sudo
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
${authorizedKeys || '      []'}
ssh_pwauth: false
runcmd:
  - systemctl enable docker
  - systemctl start docker
  - ufw allow 22/tcp
  - ufw allow ${portRangeStart}:${portRangeEnd}/tcp
  - ufw --force enable
  - mkdir -p /opt/openclaw
${prePullCommands.map((command) => `  - ${command}`).join('\n')}
`;
}

export function createProvisionHostServerWorker(): ProvisionHostServerWorkerRuntime {
  const hostServerProvider = getHostServerProvider();
  const workerConnection = createRedisConnection('provision-host-server-worker');
  const connectionPool = new Set<IORedis>([workerConnection]);

  const worker = new Worker<ProvisionHostServerJobPayload>(
    'provision-host-server',
    async (job) => {
      const { scaleEventId } = job.data;
      if (!scaleEventId) {
        throw new Error('Provision host server job missing scaleEventId');
      }

      const [scaleEvent] = await db
        .select()
        .from(serverScaleEvents)
        .where(eq(serverScaleEvents.id, scaleEventId))
        .limit(1);

      if (!scaleEvent || scaleEvent.status !== 'triggered') {
        return;
      }

      await db
        .update(serverScaleEvents)
        .set({ status: 'provisioning' })
        .where(eq(serverScaleEvents.id, scaleEvent.id));

      const [activeTemplate] = await db
        .select()
        .from(serverTemplates)
        .where(eq(serverTemplates.isActive, true))
        .limit(1);

      if (!activeTemplate) {
        throw new Error('No active server template');
      }

      const serverName = `host-${activeTemplate.region}-${Date.now()}`;
      const sshPublicKey = process.env.PROVISIONING_SSH_PUBLIC_KEY;
      const sshPublicKeys = sshPublicKey ? [sshPublicKey] : [];
      const prePullImages = (process.env.AGENT_IMAGES ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      const cloudInitScript = buildHostCloudInit({
        sshPublicKeys,
        prePullImages,
      });

      let createdHostRecordId: string | null = null;

      try {
        const created = await hostServerProvider.provisionHostServer({
          name: serverName,
          instanceType: activeTemplate.instanceType,
          region: activeTemplate.region,
          sshPublicKeys,
          cloudInitScript,
        });

        const reservedCpuMillicores = Math.floor(
          activeTemplate.expectedCpuMillicores * (activeTemplate.managementOverheadPercent / 100),
        );
        const reservedMemoryMb = Math.floor(
          activeTemplate.expectedMemoryMb * (activeTemplate.managementOverheadPercent / 100),
        );
        const reservedDiskGb = Math.floor(
          activeTemplate.expectedDiskGb * (activeTemplate.managementOverheadPercent / 100),
        );

        const [host] = await db
          .insert(hostServers)
          .values({
            name: serverName,
            provider: activeTemplate.provider,
            providerInstanceId: created.providerId,
            region: activeTemplate.region,
            ipAddress: created.ipAddress,
            instanceType: activeTemplate.instanceType,
            totalCpuMillicores: activeTemplate.expectedCpuMillicores,
            totalMemoryMb: activeTemplate.expectedMemoryMb,
            totalDiskGb: activeTemplate.expectedDiskGb,
            reservedCpuMillicores,
            reservedMemoryMb,
            reservedDiskGb,
            status: 'provisioning',
            capacityThresholdPercent: activeTemplate.capacityThresholdPercent,
          })
          .returning();

        createdHostRecordId = host.id;

        let providerStatus: 'starting' | 'running' | 'error' = 'starting';
        for (let attempt = 1; attempt <= 60; attempt += 1) {
          providerStatus = await hostServerProvider.getHostServerStatus(created.providerId);
          if (providerStatus === 'running') {
            break;
          }
          if (providerStatus === 'error') {
            throw new Error('Host provider returned error state');
          }
          await sleep(10_000);
        }

        if (providerStatus !== 'running') {
          throw new Error('ProvisionTimeoutError');
        }

        await sleep(45_000);

        await db
          .update(hostServers)
          .set({
            status: 'ready',
            readyAt: new Date(),
          })
          .where(eq(hostServers.id, host.id));

        await db
          .update(serverScaleEvents)
          .set({
            newHostServerId: host.id,
            status: 'ready',
            completedAt: new Date(),
          })
          .where(eq(serverScaleEvents.id, scaleEvent.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (createdHostRecordId) {
          await db
            .update(hostServers)
            .set({ status: 'failed' })
            .where(eq(hostServers.id, createdHostRecordId));
        }

        await db
          .update(serverScaleEvents)
          .set({
            status: 'failed',
            failedReason: message,
          })
          .where(eq(serverScaleEvents.id, scaleEvent.id));

        throw error;
      }
    },
    {
      connection: workerConnection,
      concurrency: 1,
      createClient(_type, redisOpts) {
        const client = new (workerConnection.constructor as typeof IORedis)({
          ...redisOpts,
          maxRetriesPerRequest: null,
        });
        connectionPool.add(client);
        return client;
      },
    },
  );

  return {
    worker,
    async close() {
      await worker.close();
      await Promise.all([...connectionPool].map((connection) => closeRedisConnection(connection)));
      connectionPool.clear();
    },
  };
}
