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

type AdminAccessTokenPayload = AuthenticatedAdmin & { tokenType: 'access' };
type AdminRefreshTokenPayload = AuthenticatedAdmin & { tokenType: 'refresh' };

function signAdminAccessToken(payload: AuthenticatedAdmin) {
  const tokenPayload: AdminAccessTokenPayload = { ...payload, tokenType: 'access' };
  return jwt.sign(tokenPayload, getJwtSecret(), { expiresIn: ADMIN_ACCESS_TOKEN_EXPIRES_IN });
}

function signAdminRefreshToken(payload: AuthenticatedAdmin) {
  const tokenPayload: AdminRefreshTokenPayload = { ...payload, tokenType: 'refresh' };
  return jwt.sign(tokenPayload, getJwtSecret(), { expiresIn: ADMIN_REFRESH_TOKEN_EXPIRES_IN });
}

function verifyAdminAccessToken(token: string) {
  const payload = jwt.verify(token, getJwtSecret()) as AdminAccessTokenPayload;
  if (payload.tokenType !== 'access') {
    throw new Error('Invalid admin access token');
  }
  return { sub: payload.sub, email: payload.email, role: payload.role } as AuthenticatedAdmin;
}

function verifyAdminRefreshToken(token: string) {
  const payload = jwt.verify(token, getJwtSecret()) as AdminRefreshTokenPayload;
  if (payload.tokenType !== 'refresh') {
    throw new Error('Invalid admin refresh token');
  }
  return { sub: payload.sub, email: payload.email, role: payload.role } as AuthenticatedAdmin;
}

function getCookieDomain() {
  return process.env.COOKIE_DOMAIN ?? '.aquiero.com';
}

function setAdminRefreshTokenCookie(reply: FastifyReply, token: string) {
  reply.setCookie(ADMIN_REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    domain: getCookieDomain(),
    maxAge: 60 * 60 * 24 * 30,
  });
}

function clearAdminRefreshTokenCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_REFRESH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: getCookieDomain(),
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
    request.admin = verifyAdminAccessToken(token);
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
      const payload = verifyAdminRefreshToken(refreshToken);
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
