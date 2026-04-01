import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import {
  adminAuditLog,
  products,
  provisioningJobs,
  subscriptions,
  users,
  vpsInstances,
} from '@psi/db/schema';
import { enqueueProvisionInstanceJob } from '../billing/provisioning-jobs.js';

const listQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const paramsSchema = z.object({
  jobId: z.string().uuid(),
});

function getRequestIp(request: FastifyRequest) {
  return request.ip === '127.0.0.1' ? '127.0.0.1' : request.ip;
}

async function insertAuditLog(params: {
  request: FastifyRequest;
  action: string;
  targetId: string;
  payloadSummary: Record<string, unknown>;
}) {
  await db.insert(adminAuditLog).values({
    adminUserId: params.request.admin.sub,
    action: params.action,
    targetType: 'provisioning_job',
    targetId: params.targetId,
    payloadSummary: params.payloadSummary,
    ipAddress: getRequestIp(params.request),
    createdAt: new Date(),
  });
}

export async function registerAdminProvisioningRoutes(app: FastifyInstance) {
  app.get(
    '/admin/provisioning',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.flatten() });
      }

      const { status, page, pageSize } = parsed.data;
      const offset = (page - 1) * pageSize;

      const where = status ? eq(provisioningJobs.status, status) : undefined;

      const rows = await db
        .select({
          id: provisioningJobs.id,
          userEmail: users.email,
          productName: products.name,
          status: provisioningJobs.status,
          currentStep: provisioningJobs.currentStep,
          retryCount: provisioningJobs.retryCount,
          createdAt: provisioningJobs.createdAt,
          finishedAt: provisioningJobs.finishedAt,
          errorMessage: provisioningJobs.errorMessage,
          logLines: provisioningJobs.logLines,
          vpsInstanceId: provisioningJobs.vpsInstanceId,
          subscriptionId: provisioningJobs.subscriptionId,
        })
        .from(provisioningJobs)
        .innerJoin(vpsInstances, eq(vpsInstances.id, provisioningJobs.vpsInstanceId))
        .innerJoin(subscriptions, eq(subscriptions.id, provisioningJobs.subscriptionId))
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .innerJoin(products, eq(products.id, subscriptions.productId))
        .where(where)
        .orderBy(desc(provisioningJobs.createdAt))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(provisioningJobs)
        .where(where);

      return {
        page,
        pageSize,
        total: Number(countRow?.count ?? 0),
        items: rows.map((row) => ({
          id: row.id,
          user_email: row.userEmail,
          product: row.productName,
          status: row.status,
          current_step: row.currentStep,
          retry_count: row.retryCount,
          created: row.createdAt,
          finished: row.finishedAt,
          error_message: row.errorMessage,
          log_lines: row.logLines,
          vps_instance_id: row.vpsInstanceId,
          subscription_id: row.subscriptionId,
        })),
      };
    },
  );

  app.post(
    '/admin/provisioning/:jobId/retry',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid job id' });
      }

      const [job] = await db
        .select()
        .from(provisioningJobs)
        .where(eq(provisioningJobs.id, parsed.data.jobId))
        .limit(1);

      if (!job) {
        return reply.status(404).send({ error: 'Provisioning job not found' });
      }

      if (job.status !== 'failed') {
        return reply.status(400).send({ error: 'Only failed jobs can be retried' });
      }

      const [updated] = await db
        .update(provisioningJobs)
        .set({
          status: 'queued',
          retryCount: job.retryCount + 1,
          errorMessage: null,
          finishedAt: null,
          currentStep: null,
        })
        .where(eq(provisioningJobs.id, job.id))
        .returning();

      await db
        .update(vpsInstances)
        .set({ status: 'queued' })
        .where(eq(vpsInstances.id, job.vpsInstanceId));

      await enqueueProvisionInstanceJob({
        subscriptionId: job.subscriptionId,
        vpsInstanceId: job.vpsInstanceId,
        jobId: job.id,
      });

      await insertAuditLog({
        request,
        action: 'provisioning_job.retried',
        targetId: job.id,
        payloadSummary: {
          retry_count: updated.retryCount,
          subscription_id: job.subscriptionId,
          vps_instance_id: job.vpsInstanceId,
        },
      });

      return { success: true };
    },
  );
}
