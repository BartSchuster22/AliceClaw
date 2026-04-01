import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '@psi/db';
import { profiles, referrals, users } from '@psi/db/schema';
import { z } from 'zod';

import type { AuthenticatedUser } from './types.js';

const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '30d';
const REFRESH_COOKIE_NAME = 'rt';
const BCRYPT_ROUNDS = 12;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  referral_code_used: z.string().trim().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type AccessTokenPayload = AuthenticatedUser & { tokenType: 'access' };
type RefreshTokenPayload = AuthenticatedUser & { tokenType: 'refresh' };

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }

  return secret;
}

function signAccessToken(payload: AuthenticatedUser) {
  const tokenPayload: AccessTokenPayload = { ...payload, tokenType: 'access' };
  return jwt.sign(tokenPayload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function signRefreshToken(payload: AuthenticatedUser) {
  const tokenPayload: RefreshTokenPayload = { ...payload, tokenType: 'refresh' };
  return jwt.sign(tokenPayload, getJwtSecret(), { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

function verifyAccessToken(token: string): AuthenticatedUser {
  const payload = jwt.verify(token, getJwtSecret()) as AccessTokenPayload;
  if (payload.tokenType !== 'access') {
    throw new Error('Invalid access token');
  }
  return { sub: payload.sub, email: payload.email, role: payload.role };
}

function verifyRefreshToken(token: string): AuthenticatedUser {
  const payload = jwt.verify(token, getJwtSecret()) as RefreshTokenPayload;
  if (payload.tokenType !== 'refresh') {
    throw new Error('Invalid refresh token');
  }
  return { sub: payload.sub, email: payload.email, role: payload.role };
}

function getCookieDomain() {
  return process.env.COOKIE_DOMAIN ?? '.aquiero.com';
}

function setRefreshTokenCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    domain: getCookieDomain(),
    maxAge: 60 * 60 * 24 * 30,
  });
}

function clearRefreshTokenCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: getCookieDomain(),
  });
}

async function findUserByEmail(email: string) {
  return db.$client<{ id: string; email: string; password_hash: string; referral_code: string }[]>`
    select id, email, password_hash, referral_code
    from users
    where email = ${email}
    limit 1
  `;
}

async function findUserIdByReferralCode(referralCode: string) {
  return db.$client<{ id: string }[]>`
    select id
    from users
    where referral_code = ${referralCode}
    limit 1
  `;
}

async function generateReferralCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  while (true) {
    const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    const existing = await findUserIdByReferralCode(code);

    if (existing.length === 0) {
      return code;
    }
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.slice('Bearer '.length);
    request.user = verifyAccessToken(token);
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function registerAuthModule(app: FastifyInstance) {
  await app.register(cookie);

  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { email, password, full_name, referral_code_used } = parsed.data;
    const existingUser = await findUserByEmail(email);

    if (existingUser.length > 0) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    let referringUserId: string | null = null;

    if (referral_code_used) {
      const referringUser = await findUserIdByReferralCode(referral_code_used);

      if (referringUser.length > 0) {
        referringUserId = referringUser[0].id;
      }
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const referralCode = await generateReferralCode();

    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName: full_name,
        referralCode,
        referredByUserId: referringUserId,
        emailVerified: true,
        status: 'active',
      })
      .returning();

    await db.insert(profiles).values({
      userId: user.id,
      accountType: 'private',
      companyName: null,
      taxId: null,
      phone: null,
      country: 'XX',
      onboardingState: 'pending',
    });

    if (referral_code_used && referringUserId) {
      await db.insert(referrals).values({
        referrerUserId: referringUserId,
        referredUserId: user.id,
        referralCode: referral_code_used,
        status: 'pending',
      });
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: 'user',
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(reply, refreshToken);

    return reply.send({ accessToken });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const foundUsers = await findUserByEmail(email);
    const user = foundUsers[0];

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: 'user',
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    setRefreshTokenCookie(reply, refreshToken);

    return reply.send({ accessToken });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const payload = verifyRefreshToken(refreshToken);
      const accessToken = signAccessToken(payload);

      return reply.send({ accessToken });
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.post('/auth/logout', async (_request, reply) => {
    clearRefreshTokenCookie(reply);
    return reply.status(204).send();
  });
}
