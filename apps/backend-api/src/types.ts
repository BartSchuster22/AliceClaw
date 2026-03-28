import type { FastifyRequest } from 'fastify';

export type AuthenticatedUser = {
  sub: string;
  email: string;
  role: 'user';
};

export type AuthenticatedRequest = FastifyRequest & {
  user: AuthenticatedUser;
};
