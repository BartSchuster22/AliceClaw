import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  adminRoleEnum,
  adminStatusEnum,
  adminUsers,
  cmsContent,
  products,
  referralSettings,
  userStatusEnum,
  users,
} from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://openclaw:dev_password@postgres:5432/openclaw';

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const hashPassword = (password: string) =>
  createHash('sha256').update(password).digest('hex');

async function main() {
  const [adminUser] = await db
    .insert(adminUsers)
    .values({
      email: 'admin@openclaw.local',
      passwordHash: hashPassword('admin_dev_password'),
      fullName: 'Dev Super Admin',
      role: adminRoleEnum.enumValues[0],
      status: adminStatusEnum.enumValues[0],
    })
    .onConflictDoUpdate({
      target: adminUsers.email,
      set: {
        passwordHash: hashPassword('admin_dev_password'),
        fullName: 'Dev Super Admin',
        role: adminRoleEnum.enumValues[0],
        status: adminStatusEnum.enumValues[0],
      },
    })
    .returning();

  await db
    .insert(products)
    .values({
      name: 'Starter',
      slug: 'starter',
      description: 'Starter PSI plan',
      priceCents: 2900,
      billingCycle: 'monthly',
      vpsSpec: {
        ram_gb: 4,
        cpu: 2,
        disk_gb: 40,
        os_image: 'ubuntu-22.04',
      },
      provisioningTemplateId: 'starter-template',
      active: true,
    })
    .onConflictDoUpdate({
      target: products.slug,
      set: {
        name: 'Starter',
        description: 'Starter PSI plan',
        priceCents: 2900,
        billingCycle: 'monthly',
        vpsSpec: {
          ram_gb: 4,
          cpu: 2,
          disk_gb: 40,
          os_image: 'ubuntu-22.04',
        },
        provisioningTemplateId: 'starter-template',
        active: true,
      },
    });

  await db
    .insert(products)
    .values({
      name: 'Pro',
      slug: 'pro',
      description: 'Pro PSI plan',
      priceCents: 5900,
      billingCycle: 'monthly',
      vpsSpec: {
        ram_gb: 8,
        cpu: 4,
        disk_gb: 80,
        os_image: 'ubuntu-22.04',
      },
      provisioningTemplateId: 'pro-template',
      active: true,
    })
    .onConflictDoUpdate({
      target: products.slug,
      set: {
        name: 'Pro',
        description: 'Pro PSI plan',
        priceCents: 5900,
        billingCycle: 'monthly',
        vpsSpec: {
          ram_gb: 8,
          cpu: 4,
          disk_gb: 80,
          os_image: 'ubuntu-22.04',
        },
        provisioningTemplateId: 'pro-template',
        active: true,
      },
    });

  await db
    .insert(users)
    .values({
      email: 'user@openclaw.local',
      passwordHash: hashPassword('user_dev_password'),
      fullName: 'Test User',
      referralCode: 'TEST1234',
      emailVerified: true,
      status: userStatusEnum.enumValues[0],
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: hashPassword('user_dev_password'),
        fullName: 'Test User',
        referralCode: 'TEST1234',
        emailVerified: true,
        status: userStatusEnum.enumValues[0],
      },
    });

  await db
    .insert(cmsContent)
    .values([
      {
        key: 'hero_headline',
        value: 'Deploy your OpenClaw instance in minutes.',
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
      {
        key: 'hero_subheadline',
        value: 'Hosted PSI for private users and small businesses.',
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
      {
        key: 'hero_cta_text',
        value: 'Get started',
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
      {
        key: 'product_card_footer_note',
        value: 'Simple monthly pricing on Hetzner-backed infrastructure.',
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
      {
        key: 'faq_entries',
        value: JSON.stringify([
          {
            q: 'What is a PSI?',
            a: 'A prefabricated software instance with OpenClaw pre-installed.',
          },
          {
            q: 'Can I use my own SSH key?',
            a: 'Yes, you can provide one during onboarding.',
          },
        ]),
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
      {
        key: 'footer_tagline',
        value: 'OpenClaw hosting without installation pain.',
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
    ])
    .onConflictDoUpdate({
      target: cmsContent.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`excluded.updated_at`,
        updatedByAdminId: sql`excluded.updated_by_admin_id`,
      },
    });

  await db
    .insert(referralSettings)
    .values({
      id: 1,
      globalRewardRatePercent: '10.00',
      coolingPeriodDays: 14,
      updatedAt: new Date(),
      updatedByAdminId: adminUser.id,
    })
    .onConflictDoUpdate({
      target: referralSettings.id,
      set: {
        globalRewardRatePercent: '10.00',
        coolingPeriodDays: 14,
        updatedAt: new Date(),
        updatedByAdminId: adminUser.id,
      },
    });

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
