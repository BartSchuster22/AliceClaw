import Fastify from 'fastify';
import cors from '@fastify/cors';

import { registerAuthModule, requireAuth } from './auth.js';
import { registerEmailVerificationRoutes } from './modules/auth/routes.js';
import { registerAdminAuthModule, requireAdmin, requireAdminRole } from './admin-auth.js';
import { billingEventEmitter, registerBillingHandlers, registerBillingRoutes } from './modules/billing/index.js';
import { registerProductRoutes } from './modules/products/index.js';
import { registerAdminCmsRoutes } from './modules/cms/index.js';
import { registerCmsRoutes } from './modules/cms/index.js';
import { registerOrderRoutes } from './modules/orders/index.js';
import { registerOnboardingRoutes } from './modules/onboarding/index.js';
import { registerUserRoutes } from './modules/user/index.js';
import { registerReferralRoutes } from './modules/referrals/index.js';
import { registerAdminUserRoutes } from './modules/admin-users/index.js';
import { registerAdminSubscriptionRoutes } from './modules/admin-subscriptions/index.js';
import { registerAdminProvisioningRoutes } from './modules/admin-provisioning/index.js';
import { registerAdminAuditLogRoutes } from './modules/admin-audit-log/index.js';
import { registerProductDefinitionRoutes } from './modules/product-definitions/index.js';
import { registerServerFleetRoutes } from './modules/server-fleet/index.js';
import { registerAdminAlertRoutes } from './modules/admin-alerts/index.js';
import { registerAdminAuditLogging } from './admin-audit.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

await app.register(cors, {
  origin: true,
  credentials: true,
});

await registerAdminAuditLogging(app);
registerBillingHandlers(billingEventEmitter);

await registerAuthModule(app);
await registerEmailVerificationRoutes(app);
await registerAdminAuthModule(app);
await registerBillingRoutes(app);
await registerProductRoutes(app);
await registerCmsRoutes(app);
await registerAdminCmsRoutes(app);
await registerOrderRoutes(app);
await registerOnboardingRoutes(app);
await registerUserRoutes(app);
await registerReferralRoutes(app);
await registerAdminUserRoutes(app);
await registerAdminSubscriptionRoutes(app);
await registerAdminProvisioningRoutes(app);
await registerProductDefinitionRoutes(app);
await registerServerFleetRoutes(app);
await registerAdminAlertRoutes(app);
await registerAdminAuditLogRoutes(app);

app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

app.get('/health/auth', { preHandler: requireAuth }, async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

app.get(
  '/admin/health/auth',
  { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'support_admin'])] },
  async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }),
);

await app.listen({ host, port });
