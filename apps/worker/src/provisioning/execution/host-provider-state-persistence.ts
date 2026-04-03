import { eq } from 'drizzle-orm';

import { db } from '@psi/db';
import { hostProvisionAttempts, hostServers } from '@psi/db/schema';

import type { HostServerDetails, ProviderActionInfo } from '../../providers/host-server-provider.js';

function toNullableDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

export async function persistAttemptProviderState(params: {
  attemptId: string;
  providerId?: string | null;
  details?: Pick<HostServerDetails, 'rawStatus' | 'action'> | null;
  workerRunId?: string;
}) {
  await db
    .update(hostProvisionAttempts)
    .set({
      providerInstanceId: params.providerId ?? null,
      providerActionId: params.details?.action?.id ?? null,
      providerActionCommand: params.details?.action?.command ?? null,
      providerActionStatus: params.details?.action?.status ?? params.details?.rawStatus ?? null,
      providerActionStartedAt: toNullableDate(params.details?.action?.startedAt),
      providerActionFinishedAt: toNullableDate(params.details?.action?.finishedAt),
      workerRunId: params.workerRunId,
      lastHeartbeatAt: new Date(),
    })
    .where(eq(hostProvisionAttempts.id, params.attemptId));
}

export async function persistHostProviderState(params: {
  hostId: string;
  providerId?: string | null;
  details?: Pick<HostServerDetails, 'ipAddress' | 'rawStatus' | 'action'> | null;
}) {
  await db
    .update(hostServers)
    .set({
      providerInstanceId: params.providerId ?? null,
      ...(params.details && 'ipAddress' in params.details ? { ipAddress: params.details.ipAddress ?? null } : {}),
      providerActionId: params.details?.action?.id ?? null,
      providerActionCommand: params.details?.action?.command ?? null,
      providerActionStatus: params.details?.action?.status ?? params.details?.rawStatus ?? null,
      providerActionStartedAt: toNullableDate(params.details?.action?.startedAt),
      providerActionFinishedAt: toNullableDate(params.details?.action?.finishedAt),
      lastHeartbeatAt: new Date(),
    })
    .where(eq(hostServers.id, params.hostId));
}

export function buildDeleteProviderDetails(result: { rawStatus?: string | null; action?: ProviderActionInfo | null } | null | undefined) {
  return {
    rawStatus: result?.rawStatus ?? null,
    action: result?.action ?? null,
  };
}
