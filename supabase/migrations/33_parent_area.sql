-- 33_parent_area.sql — a parent's area, for the parent settings screen.
--
-- Parents had no settings screen at all: no way to add a picture, correct a
-- mistyped number, or say which part of a city they are in. Everything that
-- screen needs already existed on `profiles` — full_name, phone_number, city,
-- province, address, avatar_url — except the area.
--
-- WHY IT IS NEEDED. `tutor_profiles.area` exists and drives the area filter on
-- /browse/tutors. A parent's area is what makes "O Level Physics tutor needed
-- in Gulberg" findable by the tutors who live near Gulberg, and it is what
-- prefills the field when they post a tuition. Without it a parent could only
-- ever give a city, and the address column is free text that is admin-verified
-- and not safe to parse for matching.
--
-- Nullable with no default, deliberately. Every existing parent keeps a NULL
-- area and nothing about their account changes; profile completion does not
-- read it, so nobody's percentage moves and no badge is granted or lost by
-- this migration. Backfilling from `address` was rejected for the same reason
-- backfilling phone_verified_at was rejected in migration 29: a guessed value
-- in a column the product treats as stated fact is worse than an empty one.
--
-- Additive only. No column is dropped, renamed or re-typed, so a running
-- deployment that has never heard of this column is unaffected.

alter table public.profiles
  add column if not exists area text;

comment on column public.profiles.area is
  'Neighbourhood or sector within city, e.g. "Gulberg", "DHA Phase 5". Set by the member on /parent/dashboard/settings; nullable — never inferred from address.';
