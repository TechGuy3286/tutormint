-- 169 — onboarding without a confirmed email, areas added by staff, school searches
-- (owner, 13 Oct 2026). Additive and idempotent: three new columns' worth of
-- facts, no existing row changes meaning. Run inside one transaction by
-- scripts/apply-migration-169.ts (no begin/commit here).
--
--   1. profiles.email_pending_confirm — true ONLY while a tutor who signed up
--      with an email has not clicked our own confirmation link yet. Default
--      false, so every existing account (and every other signup path) is
--      unaffected. It blocks nothing: the tutor can finish onboarding and pay.
--      While true, no email except the confirmation link is sent to the address.
--
--   2. location_areas — who added an area and when (staff can add one while
--      posting a tuition), and removed_at / removed_by so an added area that
--      turns out to be an existing one can be RETIRED, never deleted: its name
--      becomes a spelling of the area it was merged into (location_area_aliases).
--      The owner's curated list has created_by NULL and is unchanged.
--
--   3. search_unmet_done.kind may be 'school' — a searched text that names a
--      school is linked to that school, not added as a subject.

-- ------------------------------------------------------------------ 1 ------
alter table public.profiles add column if not exists email_pending_confirm boolean not null default false;

comment on column public.profiles.email_pending_confirm is
  'True while a tutor who signed up with an email has not clicked our confirmation link. Blocks nothing; only the confirmation email is sent to the address meanwhile (lib/emailConfirm).';

-- ------------------------------------------------------------------ 2 ------
alter table public.location_areas add column if not exists created_by uuid;
alter table public.location_areas add column if not exists created_by_name text;
alter table public.location_areas add column if not exists created_at timestamptz;
alter table public.location_areas add column if not exists removed_at timestamptz;
alter table public.location_areas add column if not exists removed_by uuid;

comment on column public.location_areas.created_by is
  'The staff member who added this area while posting a tuition. NULL for the owner''s curated list.';
comment on column public.location_areas.removed_at is
  'Set when a staff-added area was merged into an existing one. The row is kept; readers leave it out.';

-- ------------------------------------------------------------------ 3 ------
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'search_unmet_done_kind_check') then
    alter table public.search_unmet_done drop constraint search_unmet_done_kind_check;
  end if;
  alter table public.search_unmet_done
    add constraint search_unmet_done_kind_check check (kind in ('done', 'ignored', 'synonym', 'subject', 'school'));
end
$$;
