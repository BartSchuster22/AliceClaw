import { eq } from 'drizzle-orm';

import { db } from '@psi/db';
import { hostProvisionAttempts, hostServers, serverScaleEvents, serverTemplates } from '@psi/db/schema';

import type { HostServerProvider } from '../../providers/host-server-provider.js';
import { buildDeleteProviderDetails, persistAttemptProviderState, persistHostProviderState } from './host-provider-state-persistence.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatusPollIntervalMs() {
  return Number(process.env.HOST_PROVIDER_STATUS_POLL_INTERVAL_MS ?? 10_000);
}

function getStatusPollMaxAttempts() {
  return Number(process.env.HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS ?? 60);
}

function getReadyStabilizationDelayMs() {
  return Number(process.env.HOST_PROVIDER_READY_STABILIZATION_DELAY_MS ?? 45_000);
}

async function heartbeatAttempt(attemptId: string, workerRunId: string) {
  await db
    .update(hostProvisionAttempts)
    .set({
      lastHeartbeatAt: new Date(),
      workerRunId,
    })
    .where(eq(hostProvisionAttempts.id, attemptId));
}

export async function runSingleProviderProvisionAttempt(params: {
  provider: HostServerProvider;
  scaleEventId: string;
  attemptId: string;
  workerRunId: string;
  serverName: string;
  activeTemplate: typeof serverTemplates.$inferSelect;
  sshKeyRefs: Awaited<ReturnType<HostServerProvider['ensureSshKeyRefs']>>;
  cloudInitScript: string;
}) {
  const { provider, scaleEventId, attemptId, workerRunId, serverName, activeTemplate, sshKeyRefs, cloudInitScript } = params;

  let createdHostRecordId: string | null = null;
  let createdProviderId: string | null = null;

  const created = await provider.provisionHostServer({
    name: serverName,
    instanceType: activeTemplate.instanceType,
    region: activeTemplate.region,
    sshKeyRefs,
    cloudInitScript,
  });

  createdProviderId = created.providerId;

  await persistAttemptProviderState({
    attemptId,
    providerId: created.providerId,
    details: created,
    workerRunId,
  });

  const reservedCpuMillicores = Math.floor(activeTemplate.expectedCpuMillicores * (activeTemplate.managementOverheadPercent / 100));
  const reservedMemoryMb = Math.floor(activeTemplate.expectedMemoryMb * (activeTemplate.managementOverheadPercent / 100));
  const reservedDiskGb = Math.floor(activeTemplate.expectedDiskGb * (activeTemplate.managementOverheadPercent / 100));

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

  await db.update(hostProvisionAttempts).set({ hostServerId: host.id }).where(eq(hostProvisionAttempts.id, attemptId));

  await persistHostProviderState({
    hostId: host.id,
    providerId: created.providerId,
    details: created,
  });

  await persistAttemptProviderState({
    attemptId,
    providerId: created.providerId,
    details: created,
    workerRunId,
  });

  try {
    let providerStatus: 'creating' | 'starting' | 'running' | 'deleting' | 'deleted' | 'error' | 'unknown' = 'creating';

    for (let pollAttempt = 1; pollAttempt <= getStatusPollMaxAttempts(); pollAttempt += 1) {
      await heartbeatAttempt(attemptId, workerRunId);
      const providerDetails = await provider.getHostServerDetails(created.providerId);
      providerStatus = providerDetails.lifecycleStatus;

      if (!providerDetails.exists || providerStatus === 'deleted') {
        throw new Error('Host provider reported server missing during provisioning');
      }

      await persistAttemptProviderState({
        attemptId,
        providerId: created.providerId,
        details: providerDetails,
        workerRunId,
      });

      await persistHostProviderState({
        hostId: host.id,
        providerId: created.providerId,
        details: providerDetails,
      });

      if (providerStatus === 'running') {
        break;
      }
      if (providerStatus === 'error' || providerStatus === 'unknown' || providerStatus === 'deleting') {
        throw new Error(`Host provider returned terminal state: ${providerStatus}`);
      }
      await sleep(getStatusPollIntervalMs());
    }

    if (providerStatus !== 'running') {
      throw new Error('ProvisionTimeoutError');
    }

    await sleep(getReadyStabilizationDelayMs());

    await db.update(hostServers).set({ status: 'ready', readyAt: new Date() }).where(eq(hostServers.id, host.id));

    await db
      .update(serverScaleEvents)
      .set({
        newHostServerId: host.id,
        status: 'ready',
        completedAt: new Date(),
      })
      .where(eq(serverScaleEvents.id, scaleEventId));

    await db
      .update(hostProvisionAttempts)
      .set({
        status: 'completed',
        cleanupStatus: 'not_required',
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      .where(eq(hostProvisionAttempts.id, attemptId));

    return { hostId: host.id, providerId: created.providerId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    let cleanupStatus = 'not_started';

    if (createdProviderId) {
      cleanupStatus = 'in_progress';
      try {
        const deleteResult = await provider.deleteHostServer(createdProviderId);
        cleanupStatus = 'completed';

        await persistAttemptProviderState({
          attemptId,
          providerId: deleteResult.alreadyMissing ? null : createdProviderId,
          details: buildDeleteProviderDetails(deleteResult),
          workerRunId,
        });

        if (createdHostRecordId) {
          await persistHostProviderState({
            hostId: createdHostRecordId,
            providerId: deleteResult.alreadyMissing ? null : createdProviderId,
            details: {
              ipAddress: deleteResult.alreadyMissing ? null : undefined,
              ...buildDeleteProviderDetails(deleteResult),
            },
          });
        }
      } catch (cleanupError) {
        cleanupStatus = 'failed';
        console.error('[provision-host-server] cleanup failed', cleanupError);
      }
    }

    if (createdHostRecordId) {
      await db.update(hostServers).set({ status: 'failed', readyAt: null }).where(eq(hostServers.id, createdHostRecordId));
    }

    await db
      .update(serverScaleEvents)
      .set({
        status: 'failed',
        failedReason: message,
      })
      .where(eq(serverScaleEvents.id, scaleEventId));

    await db
      .update(hostProvisionAttempts)
      .set({
        status: 'failed',
        failureReason: message,
        cleanupStatus,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      .where(eq(hostProvisionAttempts.id, attemptId));

    throw error;
  }
}
