-- 190_selfie_photo_match.sql (owner, 21 Oct 2026)
--
-- The selfie is a LIVE photo. When a selfie is uploaded it is compared with the
-- tutor's profile picture (same file, or a near-identical image by perceptual
-- hash — lib/photoHashCore). A match shows staff an amber warning: "Looks the
-- same as the profile picture — check it's a live selfie." It is only a
-- warning; the Owner still decides. Additive: two nullable columns, no row
-- changed, no policy changed (user_documents has no member UPDATE policy; the
-- columns are written by the upload route through the service role).
--
--   photo_dhash            the 64-bit difference hash of the image, as 16 hex digits
--   same_as_profile_photo  true = looks the same as the profile picture; false =
--                          checked, different; null = not checked (older uploads)

alter table public.user_documents add column if not exists photo_dhash text;
alter table public.user_documents add column if not exists same_as_profile_photo boolean;
