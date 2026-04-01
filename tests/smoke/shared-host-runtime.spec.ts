/*
  PSI shared-host smoke test scaffold.

  This file documents the intended smoke/integration flows for the new runtime model.
  It is written in a Playwright-style shape, but the repository does not yet contain
  a runnable Playwright harness. That wiring is the next step after this scaffold.
*/

type TestContext = {
  // Placeholder context contract for future real test helpers.
  createPaidSubscriptionForNewUser: () => Promise<{ subscriptionId: string; verificationToken: string }>;
  getContainerInstanceBySubscriptionId: (subscriptionId: string) => Promise<any>;
  getJobs: (queueName: string) => Promise<any[]>;
  visitVerificationUrl: (token: string) => Promise<{ redirectedTo: string }>;
  createReadyHostWithCapacity: (params: { capacityForContainers: number; productSlug: string }) => Promise<{ hostId: string }>;
  runProvisionHostServerJob: (scaleEventId?: string) => Promise<void>;
  stopInstance: (containerInstanceId: string) => Promise<void>;
  startInstance: (containerInstanceId: string) => Promise<void>;
  emitBillingEvent: (eventType: string, payload: Record<string, unknown>) => Promise<void>;
};

export async function emailVerificationGateTest(ctx: TestContext) {
  const purchase = await ctx.createPaidSubscriptionForNewUser();
  const instanceBeforeVerify = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);

  if (instanceBeforeVerify?.status !== 'pending_verification') {
    throw new Error(`Expected pending_verification, got ${instanceBeforeVerify?.status}`);
  }

  const deployJobsBefore = await ctx.getJobs('deploy-container');
  if (deployJobsBefore.length !== 0) {
    throw new Error('Expected deploy-container queue to be empty before verification');
  }

  const verificationResult = await ctx.visitVerificationUrl(purchase.verificationToken);
  const deployJobsAfter = await ctx.getJobs('deploy-container');

  if (deployJobsAfter.length < 1) {
    throw new Error('Expected deploy-container job after verification');
  }

  if (!verificationResult.redirectedTo.includes(`/onboarding?subscriptionId=${purchase.subscriptionId}&deploying=true`)) {
    throw new Error(`Unexpected verification redirect: ${verificationResult.redirectedTo}`);
  }
}

export async function binPackingAndScaleOutTest(ctx: TestContext) {
  await ctx.createReadyHostWithCapacity({ capacityForContainers: 2, productSlug: 'product-a' });

  const user1 = await ctx.createPaidSubscriptionForNewUser();
  await ctx.visitVerificationUrl(user1.verificationToken);
  const instance1 = await ctx.getContainerInstanceBySubscriptionId(user1.subscriptionId);

  const user2 = await ctx.createPaidSubscriptionForNewUser();
  await ctx.visitVerificationUrl(user2.verificationToken);
  const instance2 = await ctx.getContainerInstanceBySubscriptionId(user2.subscriptionId);

  if (!instance1?.hostServerId || instance1.hostServerId !== instance2?.hostServerId) {
    throw new Error('Expected first two deployments to pack onto the same host');
  }

  const scaleEvents = await ctx.getJobs('provision-host-server');
  if (scaleEvents.length < 1) {
    throw new Error('Expected scale-out provisioning job after host threshold reached');
  }

  await ctx.runProvisionHostServerJob();

  const user3 = await ctx.createPaidSubscriptionForNewUser();
  await ctx.visitVerificationUrl(user3.verificationToken);
  const instance3 = await ctx.getContainerInstanceBySubscriptionId(user3.subscriptionId);

  if (!instance3?.hostServerId || instance3.hostServerId === instance1.hostServerId) {
    throw new Error('Expected third deployment to land on the newly provisioned host');
  }
}

export async function containerStopAndResumeTest(ctx: TestContext) {
  const purchase = await ctx.createPaidSubscriptionForNewUser();
  await ctx.visitVerificationUrl(purchase.verificationToken);

  const runningInstance = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);
  await ctx.stopInstance(runningInstance.id);

  const stoppedInstance = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);
  if (stoppedInstance?.status !== 'stopped') {
    throw new Error(`Expected stopped after stop flow, got ${stoppedInstance?.status}`);
  }

  await ctx.startInstance(runningInstance.id);
  const resumedInstance = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);
  if (resumedInstance?.status !== 'running') {
    throw new Error(`Expected running after resume flow, got ${resumedInstance?.status}`);
  }
}

export async function subscriptionGracePeriodTeardownTest(ctx: TestContext) {
  const purchase = await ctx.createPaidSubscriptionForNewUser();
  await ctx.visitVerificationUrl(purchase.verificationToken);

  const runningInstance = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);

  await ctx.emitBillingEvent('subscription.cancelled', { subscriptionId: purchase.subscriptionId });
  const stillPresent = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);
  if (stillPresent?.status === 'deleted') {
    throw new Error('Expected cancellation alone to avoid immediate teardown');
  }

  await ctx.emitBillingEvent('subscription.grace_period_ended', { subscriptionId: purchase.subscriptionId });
  const deletedInstance = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);
  if (deletedInstance?.status !== 'deleted') {
    throw new Error(`Expected deleted after grace period teardown, got ${deletedInstance?.status}`);
  }
}

export async function noCapacityQueuedRecoveryTest(ctx: TestContext) {
  const purchase = await ctx.createPaidSubscriptionForNewUser();
  await ctx.visitVerificationUrl(purchase.verificationToken);

  const queuedInstance = await ctx.getContainerInstanceBySubscriptionId(purchase.subscriptionId);
  if (queuedInstance?.status !== 'queued' && queuedInstance?.status !== 'running') {
    throw new Error(`Expected queued or running instance during no-capacity flow, got ${queuedInstance?.status}`);
  }
}
