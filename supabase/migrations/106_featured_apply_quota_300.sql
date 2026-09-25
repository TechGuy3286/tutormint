-- 106_featured_apply_quota_300.sql (PR52 §1)
--
-- Match the approved package sheet: Featured's real monthly apply cap is 300,
-- not 150. Basic (10) and Premium (100) are already correct. Featured keeps
-- displaying "Unlimited" (displayed_quota unchanged) — only the enforced number
-- behind it moves. Numbers only; no label, price or name changes.
--
-- entitlements.ts reads plans.monthly_quota live, so this takes effect the
-- moment it is applied. Deployed AFTER the code, per the PR ordering.

update plans set monthly_quota = 300 where code = 'featured';
