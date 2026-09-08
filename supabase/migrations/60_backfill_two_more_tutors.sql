-- 60_backfill_two_more_tutors.sql
--
-- Two more real tutors orphaned by the dropped on_auth_user_created trigger
-- (see migration 59). They were held back from the 59 backfill because their
-- raw_user_meta_data carries NO role; the owner has since confirmed both are
-- real signed-up tutors, so role = 'tutor' is set explicitly here rather than
-- inferred.
--
--   javeriafiaz76@gmail.com  → 951b4c61-2914-4dd2-879d-4638e87c409d
--   gullfatima5868@gmail.com → 3487fd66-05d3-49e6-926d-4382034d8972
--
-- Both are email-path accounts with no mobile: phone_number '' and
-- phone_gate_required false, so they reach their dashboard directly. full_name
-- was not in metadata, so it falls back to 'New User' (the same default the
-- trigger uses) and is set for real during profile completion. Scoped by
-- explicit id, idempotent, and a no-op on a fresh database.

begin;

with backfill(id) as (
  values
    ('951b4c61-2914-4dd2-879d-4638e87c409d'::uuid),
    ('3487fd66-05d3-49e6-926d-4382034d8972'::uuid)
)
insert into public.profiles
  (id, role, account_type, full_name, email, phone_number, phone_gate_required)
select
  u.id,
  'tutor'::user_role,
  null,
  coalesce(nullif(u.raw_user_meta_data->>'full_name',''), 'New User'),
  coalesce(u.email, ''),
  '',
  false
from auth.users u
join backfill b on b.id = u.id
on conflict (id) do nothing;

with backfill(id) as (
  values
    ('951b4c61-2914-4dd2-879d-4638e87c409d'::uuid),
    ('3487fd66-05d3-49e6-926d-4382034d8972'::uuid)
)
insert into public.tutor_profiles (id, full_name, email, verification_status)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name',''), 'New User'),
  coalesce(u.email, ''),
  'pending'::verification_status
from auth.users u
join backfill b on b.id = u.id
on conflict (id) do nothing;

commit;
