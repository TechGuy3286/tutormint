-- 156_verified_mobile_per_role.sql (owner, 8 Oct 2026)
--
-- Second-role accounts: a mobile may hold ONE tutor and ONE parent account. The
-- older uniq_verified_mobile allowed a verified mobile on ONE account of any
-- role, which refused the linked second-role account (smoke test). Replace it
-- with the same rule PER SIDE: one tutor account and one non-tutor (parent /
-- institution / staff) account per verified mobile. (role = 'tutor') is the
-- second key because an enum-to-text cast is not immutable in an index.

begin;

drop index if exists public.uniq_verified_mobile;

create unique index if not exists uniq_verified_mobile_per_role
  on public.profiles (
    right(regexp_replace(phone_number, '\D', '', 'g'), 10),
    (role = 'tutor'::user_role)
  )
  where phone_verified_at is not null
    and regexp_replace(phone_number, '\D', '', 'g') ~ '3[0-9]{9}$';

commit;
