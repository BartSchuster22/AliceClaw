import type { FastifyInstance, FastifyRequest } from 'fastify';

import { db } from '@psi/db';
import { adminAuditLog } from '@psi/db/schema';

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('password') ||
        lower.includes('secret') ||
        lower.includes('token') ||
        lower.includes('cookie') ||
        lower.includes('authorization')
      ) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeValue(nested);
      }
    }

    return result;
  }

  return value;
}

function getTargetType(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[1] ?? 'admin';
}

function getTargetId(params: Record<string, unknown>) {
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) {
      return value;
    }
  }

  return null;
}

function getRequestIp(request: FastifyRequest) {
  return request.ip === '127.0.0.1' ? '127.0.0.1' : request.ip;
}

export async function registerAdminAuditLogging(app: FastifyInstance) {
  app.addHook('onResponse', async (request) => {
    const pathname = request.routerPath ?? request.url.split('?')[0] ?? '';

    if (!pathname.startsWith('/admin/')) {
      return;
    }

    if (request.method === 'GET') {
      return;
    }

    if (pathname.startsWith('/admin/auth/')) {
      return;
    }

    if (!request.admin?.sub) {
      return;
    }

    const payloadSummary = sanitizeValue((request.body ?? {}) as Record<string, unknown>);

    await db.insert(adminAuditLog).values({
      adminUserId: request.admin.sub,
      action: `${request.method} ${pathname}`,
      targetType: getTargetType(pathname),
      targetId: getTargetId((request.params ?? {}) as Record<string, unknown>),
      payloadSummary: (payloadSummary ?? {}) as Record<string, unknown>,
      ipAddress: getRequestIp(request),
      createdAt: new Date(),
    });
  });
}
