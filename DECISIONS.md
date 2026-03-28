# DECISIONS.md

## PRODUCT MATRIX

Product 1 name:
Product 1 price (monthly):
Product 1 VPS spec (RAM / CPU / disk):
Product 1 region options:

## ONBOARDING WIZARD QUESTIONS

Step 1: welcome (no input)
Step 2: full name, phone, country (required)
Step 3: account type (private / business), company name if business
Step 4: intended use-case (free text, max 200 chars)
Step 5: preferred region (EU / US / APAC)
Step 6: SSH public key (optional)
Step 7: accept terms + privacy (required checkbox)

## REFERRAL RULES

Reward rate: __% subscription credit
Cooling period before reward vests: __ days
Fraud flag trigger: __

## PROVISIONING STATES

queued → creating_server → server_ready → provisioning → completed
Any step can → failed. Retry is admin-initiated only.
