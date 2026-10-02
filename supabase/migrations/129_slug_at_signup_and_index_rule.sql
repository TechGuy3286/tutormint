-- 129_slug_at_signup_and_index_rule.sql (PR100 §1 + §2)
--
-- §1  A slug at SIGN-UP. handle_new_user() inserts tutor_profiles with the name
--     (and city) but the slug-refresh trigger only fired AFTER UPDATE OF
--     full_name, city — never on INSERT — so a brand-new tutor got no address
--     until some later edit, and once they were listed the address froze NULL.
--     We make the trigger fire on INSERT too (the function already runs
--     refresh_tutor_slug, which is a no-op once a tutor is listed, so an insert
--     by a fresh, not-yet-listed tutor gets "<name>-tutor[-<city>]"). Old
--     addresses still redirect: every move goes through set_tutor_slug, which
--     writes slug_history.
--
-- §2  The indexing rule. A tutor page is indexable / in the sitemap ONLY when
--     profile_completion = 100 AND the Rs 199 fee is paid — REPLACING the
--     "step 1 complete" rule (owner, PR100). The TS mirror is
--     lib/seo/indexable.ts tutorProfileIndexable; this is its bulk SQL twin.
--     (tutor_directory already enforces moderation/mobile/city/subjects and
--     excludes seed/team/suspended/banned/rejected/under-review, so this only
--     adds the two index gates on top.)

-- §1a — THE REAL FIX. The directory was relaxed to "list every real tutor", so
-- a brand-new pending tutor is in tutor_directory IMMEDIATELY — and
-- refresh_tutor_slug's "listed → freeze the address" guard therefore froze
-- EVERY tutor at slug NULL from birth (nothing ever generated one). A NULL
-- address has no incoming links to protect, so give a listed tutor their FIRST
-- address anyway; only freeze an EXISTING, non-null address once listed. This
-- is also what makes the backfill work for the 9 already-listed null-slug
-- tutors (owner, PR100).
create or replace function public.refresh_tutor_slug(p_tutor uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current text;
  v_locked  boolean;
  v_new     text;
begin
  select slug, slug_locked into v_current, v_locked
  from public.tutor_profiles where id = p_tutor;

  if not found or coalesce(v_locked, false) then
    return v_current;
  end if;

  -- Freeze an EXISTING address once listed (a held link must not move). A NULL
  -- address has none, so a listed tutor with no slug still gets their first one.
  if v_current is not null and v_current <> ''
     and exists (select 1 from public.tutor_directory where id = p_tutor) then
    return v_current;
  end if;

  v_new := public.tutor_canonical_slug(p_tutor);
  if v_new is null or v_new = '' or v_new is not distinct from v_current then
    return v_current;
  end if;

  return public.set_tutor_slug(p_tutor, v_new);
end $function$;

-- §1 — slug-refresh trigger function: guard the re-entry check so it works on
-- INSERT (where OLD does not exist).
create or replace function public.tutor_profiles_refresh_slug()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- On UPDATE, the address itself moving is not a reason to re-derive it (and
  -- this is what keeps set_tutor_slug()'s own UPDATE from re-entering). On
  -- INSERT there is no OLD, so skip the check and derive the first address.
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    return null;
  end if;
  perform public.refresh_tutor_slug(new.id);
  return null;
end $function$;

drop trigger if exists tutor_profiles_slug_refresh on public.tutor_profiles;
create trigger tutor_profiles_slug_refresh
  after insert or update of full_name, city on public.tutor_profiles
  for each row execute function public.tutor_profiles_refresh_slug();

-- §2 — the sitemap/index rule: completion = 100 AND fee paid. CREATE OR REPLACE
-- keeps the signature and the existing grants.
create or replace function public.listed_tutor_slugs()
returns table(slug text, updated_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    -- The directory already excludes seed/team/suspended/banned/rejected/
    -- under-review and enforces mobile/city/subjects; this keeps the belt-and-
    -- braces seed guard and adds the two INDEX gates (owner, PR100):
    and coalesce(p.is_seed, false) = false
    and coalesce(p.profile_completion, 0) >= 100   -- same % as the dashboard
    and tp.verified_fee_paid_at is not null;        -- Rs 199 fee paid
$function$;
