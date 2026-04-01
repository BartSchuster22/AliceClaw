import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@psi/db';
import {
  containerInstances,
  hostServers,
  serverScaleEvents,
  serverTemplates,
} from '@psi/db/schema';

const ACTIVE_ALLOCATION_STATUSES = [
  'allocating',
  'deploying',
  'starting',
  'running',
  'unhealthy',
] as const;

function getPortRange() {
  const start = Number(process.env.HOST_AGENT_PORT_RANGE_START ?? 3000);
  const end = Number(process.env.HOST_AGENT_PORT_RANGE_END ?? 3500);
  return { start, end };
}

function toPercent(used: number, total: number) {
  if (total <= 0) {
    return 100;
  }

  return (used / total) * 100;
}

async function getHostResourceUsage(hostServerId: string) {
  const rows = await db
    .select({
      assignedCpuMillicores: containerInstances.assignedCpuMillicores,
      assignedMemoryMb: containerInstances.assignedMemoryMb,
      assignedDiskGb: containerInstances.assignedDiskGb,
      assignedPort: containerInstances.assignedPort,
    })
    .from(containerInstances)
    .where(
      and(
        eq(containerInstances.hostServerId, hostServerId),
        inArray(containerInstances.status, [...ACTIVE_ALLOCATION_STATUSES]),
      ),
    );

  return rows.reduce(
    (acc, row) => {
      acc.usedCpuMillicores += row.assignedCpuMillicores ?? 0;
      acc.usedMemoryMb += row.assignedMemoryMb ?? 0;
      acc.usedDiskGb += row.assignedDiskGb ?? 0;
      if (row.assignedPort != null) {
        acc.usedPorts.add(row.assignedPort);
      }
      return acc;
    },
    {
      usedCpuMillicores: 0,
      usedMemoryMb: 0,
      usedDiskGb: 0,
      usedPorts: new Set<number>(),
    },
  );
}

export class SlotAllocator {
  async findAvailableHost(productDefinition: { cpuMillicores: number; memoryMb: number; diskGb: number }) {
    const readyHosts = await db
      .select()
      .from(hostServers)
      .where(eq(hostServers.status, 'ready'));

    let bestHost: (typeof hostServers.$inferSelect & { postPlacementUtilPercent: number }) | null = null;

    for (const host of readyHosts) {
      const usage = await getHostResourceUsage(host.id);
      const usableCpu = host.totalCpuMillicores - host.reservedCpuMillicores;
      const usableMemory = host.totalMemoryMb - host.reservedMemoryMb;
      const usableDisk = host.totalDiskGb - host.reservedDiskGb;

      const nextCpu = usage.usedCpuMillicores + productDefinition.cpuMillicores;
      const nextMemory = usage.usedMemoryMb + productDefinition.memoryMb;
      const nextDisk = usage.usedDiskGb + productDefinition.diskGb;

      if (nextCpu > usableCpu || nextMemory > usableMemory || nextDisk > usableDisk) {
        continue;
      }

      const postPlacementUtilPercent = Math.max(
        toPercent(nextCpu, usableCpu),
        toPercent(nextMemory, usableMemory),
      );

      if (postPlacementUtilPercent > host.capacityThresholdPercent) {
        continue;
      }

      if (!bestHost || postPlacementUtilPercent > bestHost.postPlacementUtilPercent) {
        bestHost = {
          ...host,
          postPlacementUtilPercent,
        };
      }
    }

    return bestHost;
  }

  async assignPort(hostServerId: string) {
    const usage = await getHostResourceUsage(hostServerId);
    const { start, end } = getPortRange();

    for (let port = start; port <= end; port += 1) {
      if (!usage.usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error(`No ports available on host ${hostServerId}`);
  }

  async checkAndTriggerScaleOut(hostServerId: string) {
    const [host] = await db.select().from(hostServers).where(eq(hostServers.id, hostServerId)).limit(1);
    if (!host) {
      throw new Error(`Host server not found: ${hostServerId}`);
    }

    const usage = await getHostResourceUsage(host.id);
    const usableCpu = host.totalCpuMillicores - host.reservedCpuMillicores;
    const usableMemory = host.totalMemoryMb - host.reservedMemoryMb;
    const utilPercent = Math.max(
      toPercent(usage.usedCpuMillicores, usableCpu),
      toPercent(usage.usedMemoryMb, usableMemory),
    );

    const [activeTemplate] = await db
      .select()
      .from(serverTemplates)
      .where(eq(serverTemplates.isActive, true))
      .limit(1);

    if (!activeTemplate) {
      return null;
    }

    const threshold = activeTemplate.capacityThresholdPercent ?? host.capacityThresholdPercent;
    if (utilPercent < threshold) {
      return null;
    }

    const [existingScaleEvent] = await db
      .select()
      .from(serverScaleEvents)
      .where(
        and(
          eq(serverScaleEvents.triggerHostServerId, host.id),
          inArray(serverScaleEvents.status, ['triggered', 'provisioning']),
        ),
      )
      .limit(1);

    if (existingScaleEvent) {
      return existingScaleEvent;
    }

    const [scaleEvent] = await db
      .insert(serverScaleEvents)
      .values({
        triggerHostServerId: host.id,
        triggerReason: 'threshold_reached',
        status: 'triggered',
      })
      .returning();

    return scaleEvent;
  }

  async hasAnyActiveScaleOut() {
    const [existingScaleEvent] = await db
      .select()
      .from(serverScaleEvents)
      .where(inArray(serverScaleEvents.status, ['triggered', 'provisioning']))
      .limit(1);

    return Boolean(existingScaleEvent);
  }
}

export const slotAllocator = new SlotAllocator();
