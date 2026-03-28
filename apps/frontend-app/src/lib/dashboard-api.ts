import { fetchJson } from './api';

export type UserProfile = {
  userId: string;
  email: string;
  fullName: string;
  referralCode: string;
  emailVerified: boolean;
  userStatus: string;
  profileId: string | null;
  accountType: 'private' | 'business' | null;
  companyName: string | null;
  taxId: string | null;
  phone: string | null;
  country: string | null;
  onboardingState: string | null;
};

export type UserSubscription = {
  subscriptionId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  productId: string;
  productName: string;
  productSlug: string;
  priceCents: number;
  billingCycle: 'monthly' | 'annual';
  vpsInstanceId: string | null;
  vpsStatus: string | null;
  ipAddress: string | null;
  region: string | null;
};

export type InstanceStatusResponse = {
  instance: {
    id: string;
    status: string;
    providerInstanceId: string | null;
    ipAddress: string | null;
    region: string | null;
    subscriptionId: string;
  };
  provisioningJob: {
    id: string;
    status: string;
    currentStep: string | null;
    errorMessage: string | null;
    logLines: string[];
    createdAt: string;
  } | null;
};

export type UserReferralsResponse = {
  referralCode: string | null;
  referralLink: string;
  activeCount: number;
  convertedCount: number;
  totalCreditCents: number;
  ledger: Array<{
    id: string;
    amountCents: number;
    status: string;
    reason: string;
    createdAt: string;
  }>;
  referrals: Array<{
    id: string;
    referredUserId: string;
    referralCode: string;
    orderId: string | null;
    status: string;
    createdAt: string;
  }>;
};

export function refreshAccessToken() {
  return fetchJson<{ accessToken: string }>('/auth/refresh', {
    method: 'POST',
  });
}

export function logout() {
  return fetchJson<unknown>('/auth/logout', {
    method: 'POST',
  });
}

export function getUserProfile(accessToken: string) {
  return fetchJson<UserProfile>('/user/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateUserProfile(
  accessToken: string,
  input: { full_name?: string; phone?: string; company_name?: string; country?: string },
) {
  return fetchJson<UserProfile>('/user/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
}

export function getUserSubscriptions(accessToken: string) {
  return fetchJson<UserSubscription[]>('/user/subscriptions', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getInstanceStatus(accessToken: string, instanceId: string) {
  return fetchJson<InstanceStatusResponse>(`/user/instances/${instanceId}/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getUserReferrals(accessToken: string) {
  return fetchJson<UserReferralsResponse>('/user/referrals', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function changePassword(accessToken: string, input: { currentPassword: string; newPassword: string }) {
  return fetchJson<{ success: true }>('/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
}
