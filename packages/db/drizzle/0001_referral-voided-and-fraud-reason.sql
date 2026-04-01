ALTER TYPE referral_status ADD VALUE IF NOT EXISTS 'voided';

ALTER TABLE referrals
ADD COLUMN IF NOT EXISTS fraud_reason text;
