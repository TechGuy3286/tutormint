-- 10_tutor_profiles_roles.sql
-- Every tutor_profiles row needs a matching profiles row, because
-- profiles.role is where T2 reads the user's role from. 05_data_migration.sql
-- followed the mapping list literally (tutors -> tutor_profiles, parents ->
-- profiles), which left the migrated tutors with no role.
--
-- email and phone_number on profiles are NOT NULL; email comes from
-- auth.users, phone_number falls back to the tutor's own number and then to ''
-- rather than being invented.
--
-- Idempotent: inserts only where no profiles row exists.

insert into public.profiles (id, role, account_type, full_name, email, phone_number, city, avatar_url, created_at)
select
  tp.id,
  'tutor'::user_role,
  null,
  coalesce(tp.full_name, 'Tutor'),
  u.email,
  coalesce(tp.phone_number, ''),
  tp.city,
  tp.avatar_url,
  tp.created_at
from public.tutor_profiles tp
join auth.users u on u.id = tp.id
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = tp.id);
