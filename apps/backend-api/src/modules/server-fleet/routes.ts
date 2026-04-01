import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import { containerInstances, hostProvisionAttempts, hostServers, serverScaleEvents, serverTemplates } from '@psi/db/schema';
import { enqueueProvisionHostServerJob, enqueueRetireHostServerJob } from '../../lib/queues.js';

const activeRuntimeStatuses = ['allocating', 'deploying', 'starting', 'running', 'unhealthy'] as const;

function toPercent(used: number, total: number) {
  if (total <= 0) {
    return 100;
  }

  return (used / total) * 100;
}

export async function registerServerFleetRoutes(app: FastifyInstance) {
  app.get(
    '/admin/servers',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async () => {
      const rows = await db.select().from(hostServers).where(isNull(hostServers.archivedAt)).orderBy(desc(hostServers.createdAt));

      const hydrated = await Promise.all(
        rows.map(async (host) => {
          const [usage] = await db
            .select({
              usedCpu: sql<number>`coalesce(sum(${containerInstances.assignedCpuMillicores}), 0)`,
              usedMemory: sql<number>`coalesce(sum(${containerInstances.assignedMemoryMb}), 0)`,
              containerCount: sql<number>`count(*)`,
            })
            .from(containerInstances)
            .where(
              and(
                eq(containerInstances.hostServerId, host.id),
                inArray(containerInstances.status, [...activeRuntimeStatuses]),
              ),
            );

          const [latestAttempt] = await db
            .select()
            .from(hostProvisionAttempts)
            .where(eq(hostProvisionAttempts.hostServerId, host.id))
            .orderBy(desc(hostProvisionAttempts.createdAt))
            .limit(1);

          const usableCpu = host.totalCpuMillicores - host.reservedCpuMillicores;
          const usableMemory = host.totalMemoryMb - host.reservedMemoryMb;
          const utilPercent = Math.max(
            toPercent(Number(usage?.usedCpu ?? 0), usableCpu),
            toPercent(Number(usage?.usedMemory ?? 0), usableMemory),
          );

          return {
            ...host,
            usedCpu: Number(usage?.usedCpu ?? 0),
            usedMemory: Number(usage?.usedMemory ?? 0),
            containerCount: Number(usage?.containerCount ?? 0),
            utilPercent,
            latestProvisionAttempt: latestAttempt ?? null,
          };
        }),
      );

      return hydrated;
    },
  );

  app.get(
    '/admin/servers/:id',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid host id' });
      }

      const [host] = await db.select().from(hostServers).where(eq(hostServers.id, params.data.id)).limit(1);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      const containers = await db
        .select({
          id: containerInstances.id,
          userId: containerInstances.userId,
          status: containerInstances.status,
          agentUrl: containerInstances.agentUrl,
          startedAt: containerInstances.startedAt,
          subscriptionId: containerInstances.subscriptionId,
        })
        .from(containerInstances)
        .where(eq(containerInstances.hostServerId, host.id))
        .orderBy(desc(containerInstances.createdAt));

      const scaleEvents = await db
        .select()
        .from(serverScaleEvents)
        .where(eq(serverScaleEvents.triggerHostServerId, host.id))
        .orderBy(desc(serverScaleEvents.createdAt));

      const provisionAttempts = await db
        .select()
        .from(hostProvisionAttempts)
        .where(eq(hostProvisionAttempts.hostServerId, host.id))
        .orderBy(desc(hostProvisionAttempts.createdAt));

      return {
        host,
        containers,
        scaleEvents,
        provisionAttempts,
      };
    },
  );

  app.post(
    '/admin/servers/provision',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const parsed = z.object({ reason: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
      }

      const [activeTemplate] = await db
        .select()
        .from(serverTemplates)
        .where(eq(serverTemplates.isActive, true))
        .limit(1);

      if (!activeTemplate) {
        return reply.status(409).send({ error: 'No active server template configured' });
      }

      const [scaleEvent] = await db
        .insert(serverScaleEvents)
        .values({
          triggerReason: `manual:${parsed.data.reason}`,
          status: 'triggered',
        })
        .returning();

      await enqueueProvisionHostServerJob({ scaleEventId: scaleEvent.id });

      return {
        success: true,
        scaleEventId: scaleEvent.id,
      };
    },
  );

  app.post(
    '/admin/scale-events/:id/retry',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid scale event id' });
      }

      const [scaleEvent] = await db
        .select()
        .from(serverScaleEvents)
        .where(eq(serverScaleEvents.id, params.data.id))
        .limit(1);

      if (!scaleEvent) {
        return reply.status(404).send({ error: 'Scale event not found' });
      }

      if (scaleEvent.status !== 'failed') {
        return reply.status(409).send({ error: 'Only failed scale events can be retried' });
      }

      const [activeTemplate] = await db
        .select()
        .from(serverTemplates)
        .where(eq(serverTemplates.isActive, true))
        .limit(1);

      if (!activeTemplate) {
        return reply.status(409).send({ error: 'No active server template configured' });
      }

      const [retryScaleEvent] = await db
        .insert(serverScaleEvents)
        .values({
          triggerHostServerId: scaleEvent.triggerHostServerId,
          triggerReason: `${scaleEvent.triggerReason}:retry`,
          status: 'triggered',
        })
        .returning();

      await enqueueProvisionHostServerJob({ scaleEventId: retryScaleEvent.id });

      return {
        success: true,
        originalScaleEventId: scaleEvent.id,
        retryScaleEventId: retryScaleEvent.id,
      };
    },
  );

  app.post(
    '/admin/servers/:id/retire',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid host id' });
      }

      const [host] = await db.select().from(hostServers).where(eq(hostServers.id, params.data.id)).limit(1);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      if (!['failed', 'draining'].includes(host.status)) {
        return reply.status(409).send({ error: 'Only failed or draining hosts can be retired' });
      }

      const [usage] = await db
        .select({ count: sql<number>`count(*)` })
        .from(containerInstances)
        .where(
          and(
            eq(containerInstances.hostServerId, host.id),
            inArray(containerInstances.status, [...activeRuntimeStatuses]),
          ),
        );

      if (Number(usage?.count ?? 0) > 0) {
        return reply.status(409).send({ error: 'Host still has active containers' });
      }

      await enqueueRetireHostServerJob({ hostServerId: host.id });

      return { success: true, queued: true };
    },
  );

  app.post(
    '/admin/servers/:id/archive',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid host id' });
      }

      const [host] = await db.select().from(hostServers).where(eq(hostServers.id, params.data.id)).limit(1);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      if (!['failed', 'draining'].includes(host.status)) {
        return reply.status(409).send({ error: 'Only failed or draining hosts can be archived' });
      }

      const [usage] = await db
        .select({ count: sql<number>`count(*)` })
        .from(containerInstances)
        .where(
          and(
            eq(containerInstances.hostServerId, host.id),
            inArray(containerInstances.status, [...activeRuntimeStatuses]),
          ),
        );

      if (Number(usage?.count ?? 0) > 0) {
        return reply.status(409).send({ error: 'Host still has active containers' });
      }

      await db.update(hostServers).set({ archivedAt: new Date() }).where(eq(hostServers.id, host.id));
      return { success: true };
    },
  );

  app.post(
    '/admin/scale-events/archive-stale-failed',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async () => {
      const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const archivedScaleEvents = await db
        .update(serverScaleEvents)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(serverScaleEvents.status, 'failed'),
            isNull(serverScaleEvents.archivedAt),
            lt(serverScaleEvents.createdAt, staleBefore),
          ),
        )
        .returning({ id: serverScaleEvents.id });

      const archivedHosts = await db
        .update(hostServers)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(hostServers.status, 'failed'),
            isNull(hostServers.archivedAt),
            lt(hostServers.createdAt, staleBefore),
          ),
        )
        .returning({ id: hostServers.id });

      return {
        success: true,
        archivedScaleEventCount: archivedScaleEvents.length,
        archivedHostCount: archivedHosts.length,
      };
    },
  );

  app.post(
    '/admin/servers/:id/drain',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid host id' });
      }

      const [host] = await db.select().from(hostServers).where(eq(hostServers.id, params.data.id)).limit(1);
      if (!host) {
        return reply.status(404).send({ error: 'Host not found' });
      }

      await db.update(hostServers).set({ status: 'draining' }).where(eq(hostServers.id, host.id));

      const [usage] = await db
        .select({ count: sql<number>`count(*)` })
        .from(containerInstances)
        .where(
          and(
            eq(containerInstances.hostServerId, host.id),
            inArray(containerInstances.status, [...activeRuntimeStatuses]),
          ),
        );

      return { success: true, runningContainers: Number(usage?.count ?? 0) };
    },
  );

  app.get(
    '/admin/server-templates',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async () => {
      return db.select().from(serverTemplates).orderBy(desc(serverTemplates.createdAt));
    },
  );

  app.post(
    '/admin/server-templates',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const parsed = z
        .object({
          name: z.string().min(1),
          provider: z.string().min(1).default('hetzner'),
          instanceType: z.string().min(1),
          region: z.string().min(1),
          capacityThresholdPercent: z.number().int().min(50).max(95),
          managementOverheadPercent: z.number().int().min(10).max(30),
          expectedCpuMillicores: z.number().int().positive(),
          expectedMemoryMb: z.number().int().positive(),
          expectedDiskGb: z.number().int().positive(),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
      }

      const [created] = await db
        .insert(serverTemplates)
        .values({
          ...parsed.data,
          isActive: false,
        })
        .returning();

      return created;
    },
  );

  app.patch(
    '/admin/server-templates/:id',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const parsed = z
        .object({
          name: z.string().min(1).optional(),
          provider: z.string().min(1).optional(),
          instanceType: z.string().min(1).optional(),
          region: z.string().min(1).optional(),
          capacityThresholdPercent: z.number().int().min(50).max(95).optional(),
          managementOverheadPercent: z.number().int().min(10).max(30).optional(),
          expectedCpuMillicores: z.number().int().positive().optional(),
          expectedMemoryMb: z.number().int().positive().optional(),
          expectedDiskGb: z.number().int().positive().optional(),
          isActive: z.boolean().optional(),
        })
        .safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request', details: parsed.success ? undefined : parsed.error.flatten() });
      }

      if (parsed.data.isActive === true) {
        await db.update(serverTemplates).set({ isActive: false }).where(eq(serverTemplates.isActive, true));
      }

      const [updated] = await db
        .update(serverTemplates)
        .set(parsed.data)
        .where(eq(serverTemplates.id, params.data.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Server template not found' });
      }

      return updated;
    },
  );

  app.get(
    '/admin/scale-events',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async () => {
      const events = await db
        .select()
        .from(serverScaleEvents)
        .where(isNull(serverScaleEvents.archivedAt))
        .orderBy(desc(serverScaleEvents.createdAt));

      return Promise.all(
        events.map(async (event) => {
          const [latestAttempt] = await db
            .select()
            .from(hostProvisionAttempts)
            .where(eq(hostProvisionAttempts.scaleEventId, event.id))
            .orderBy(desc(hostProvisionAttempts.createdAt))
            .limit(1);

          return {
            ...event,
            latestProvisionAttempt: latestAttempt ?? null,
          };
        }),
      );
    },
  );
}
