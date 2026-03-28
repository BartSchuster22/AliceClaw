import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '@psi/db';

const ADMIN_REFRESH_COOKIE_NAME = 'admin_rt';
const ADMIN_ACCESS_TOKEN_EXPIRES_IN = '15m';
const ADMIN_REFRESH_TOKEN_EXPIRES_IN = '30d';

export type AdminRole =
  | 'super_admin'
  | 'support_admin'
  | 'billing_admin'
  | 'content_admin'
  | 'provisioning_admin'
  | 'referral_admin';

export type AuthenticatedAdmin = {
  sub: string;
  email: string;
  role: AdminRole;
};

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

declare module 'fastify' {
  interface FastifyRequest {
    admin: AuthenticatedAdmin;
  }
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }

  return secret;
}

function signAdminAccessToken(payload: AuthenticatedAdmin) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ADMIN_ACCESS_TOKEN_EXPIRES_IN });
}

function signAdminRefreshToken(payload: AuthenticatedAdmin) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ADMIN_REFRESH_TOKEN_EXPIRES_IN });
}

function verifyAdminToken(token: string) {
  return jwt.verify(token, getJwtSecret()) as AuthenticatedAdmin;
}

function setAdminRefreshTokenCookie(reply: FastifyReply, token: string) {
  reply.setCookie(ADMIN_REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

function clearAdminRefreshTokenCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_REFRESH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });
}

async function findAdminByEmail(email: string) {
  return db.$client<{ id: string; email: string; password_hash: string; role: AdminRole }[]>`
    select id, email, password_hash, role
    from admin_users
    where email = ${email}
    limit 1
  `;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.slice('Bearer '.length);
    request.admin = verifyAdminToken(token);
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

export function requireAdminRole(allowedRoles: AdminRole[]) {
  return async function adminRoleGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.admin) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (!allowedRoles.includes(request.admin.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}

export async function registerAdminAuthModule(app: FastifyInstance) {
  app.post('/admin/auth/login', async (request, reply) => {
    const parsed = adminLoginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const foundAdmins = await findAdminByEmail(email);
    const admin = foundAdmins[0];

    if (!admin) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, admin.password_hash);

    if (!isValidPassword) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const payload: AuthenticatedAdmin = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    };

    const accessToken = signAdminAccessToken(payload);
    const refreshToken = signAdminRefreshToken(payload);

    setAdminRefreshTokenCookie(reply, refreshToken);

    return reply.send({ accessToken });
  });

  app.post('/admin/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies[ADMIN_REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const payload = verifyAdminToken(refreshToken);
      const accessToken = signAdminAccessToken(payload);

      return reply.send({ accessToken });
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.post('/admin/auth/logout', async (_request, reply) => {
    clearAdminRefreshTokenCookie(reply);
    return reply.status(204).send();
  });
}
