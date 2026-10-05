-- 138_tutor_profiles_updated_at.sql (owner, 5 Oct 2026 — item 5)
--
-- The tutor sitemap's lastmod is greatest(created_at, tutor_profiles.updated_at)
-- (listed_tutor_slugs), meant to be "the profile's last real update". The column
-- exists but NOTHING maintained it — no trigger and no application write — so
-- every tutor's lastmod was their created_at. This keeps updated_at honest: it is
-- stamped on every UPDATE of the row, which covers every profile edit (the
-- onboarding and Settings writes, the avatar mirror, the slug refresh) without a
-- single application change. Additive; no data change beyond the stamp.

create or replace function public.set_tutor_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tutor_profiles_set_updated_at on public.tutor_profiles;
create trigger tutor_profiles_set_updated_at
  before update on public.tutor_profiles
  for each row execute function public.set_tutor_profiles_updated_at();
