-- 26_t7b_growth.sql
-- T7b: advertisements, bulk tutor import, claim flow.
--
-- SAFETY: CREATE / ADD / ENABLE / CREATE OR REPLACE only, plus two REVOKEs
-- that narrow access (called out below). No DROP, RENAME, DELETE, TRUNCATE or
-- column-type change, and the file is idempotent.
--
-- The REVOKE: table-level SELECT on advertisements is withdrawn from anon and
-- authenticated and re-granted column by column, leaving out `created_by`.
-- Row-level security cannot hide a column, and the rotation component has to
-- read ads with the anon key, so a column privilege is the only way to keep
-- "which admin sold this ad" out of a public response.
--
-- It has to be done this way round: a column-level REVOKE against a table-level
-- grant does nothing, because the table grant already covers every column. So
-- the table grant goes first, then the columns we do want come back.
--
-- Admin screens read through the service role and are unaffected. Reversible
-- with one GRANT SELECT if it ever turns out to matter.

-- --------------------------------------------------------- advertisements --
-- The legacy table (title, client_name, description, cta_link, is_active) has
-- zero rows and is kept rather than replaced. client_name and description are
-- NOT NULL with no default, which would make every new insert carry fields the
-- revenue spec does not have; giving them defaults is enough, and does not
-- touch the existing definition.
alter table public.advertisements alter column client_name set default '';
alter table public.advertisements alter column description set default '';

alter table public.advertisements add column if not exists image_path text;
alter table public.advertisements add column if not exists target_url text;
alter table public.advertisements add column if not exists audience text not null default 'both';
alter table public.advertisements add column if not exists starts_at timestamptz not null default now();
alter table public.advertisements add column if not exists ends_at timestamptz;
alter table public.advertisements add column if not exists weight integer not null default 1;
alter table public.advertisements add column if not exists status text not null default 'draft';
alter table public.advertisements add column if not exists created_by uuid references auth.users(id) on delete set null;
-- Denormalised counters, maintained by the trigger below. ad_events keeps the
-- detail for analytics; these keep the list screen cheap.
alter table public.advertisements add column if not exists impressions bigint not null default 0;
alter table public.advertisements add column if not exists clicks bigint not null default 0;
alter table public.advertisements add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.advertisements add constraint advertisements_audience_check
    check (audience in ('parents', 'tutors', 'both'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.advertisements add constraint advertisements_status_check
    check (status in ('draft', 'active', 'paused'));
exception when duplicate_object then null;
end $$;

do $$
begin
  -- A weight is a share of a rotation, not a bid. Capping it keeps one ad from
  -- being able to take the whole slot by typing a big number.
  alter table public.advertisements add constraint advertisements_weight_check
    check (weight between 1 and 100);
exception when duplicate_object then null;
end $$;

create index if not exists advertisements_rotation_idx
  on public.advertisements (status, audience, starts_at, ends_at)
  where status = 'active';

-- Public read of ACTIVE ads only. Permissive policies OR together, so the
-- existing admin policy still gives admins everything; this adds exactly the
-- rows a visitor's browser needs to render a banner, and nothing else.
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'advertisements'
                   and policyname = 'advertisements_public_active_read') then
    create policy advertisements_public_active_read on public.advertisements
      for select using (
        status = 'active'
        and starts_at <= now()
        and (ends_at is null or ends_at > now())
      );
  end if;
end $$;

revoke select on public.advertisements from anon, authenticated;
grant select (
  id, title, client_name, description, cta_link, is_active, created_at,
  image_path, target_url, audience, starts_at, ends_at, weight, status,
  impressions, clicks, updated_at
) on public.advertisements to anon, authenticated;

-- ------------------------------------------------------------- ad_events ----
-- One row per impression and per click. Written only through the server (the
-- rotation component and the click redirect), never by a browser: there is an
-- INSERT policy for nobody, so the anon key cannot inflate an advertiser's
-- numbers, which is the whole reason the numbers are worth reporting.
create table if not exists public.ad_events (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.advertisements(id) on delete cascade,
  kind text not null check (kind in ('impression', 'click')),
  slot text,
  viewer_role text,
  occurred_at timestamptz not null default now()
);

alter table public.ad_events enable row level security;

create index if not exists ad_events_ad_idx on public.ad_events (ad_id, kind, occurred_at desc);

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'ad_events'
                   and policyname = 'ad_events_admin_read') then
    create policy ad_events_admin_read on public.ad_events
      for select using (public.is_admin());
  end if;
end $$;

create or replace function public.bump_ad_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'impression' then
    update public.advertisements set impressions = impressions + 1 where id = new.ad_id;
  else
    update public.advertisements set clicks = clicks + 1 where id = new.ad_id;
  end if;
  return new;
end $$;

drop trigger if exists ad_events_bump on public.ad_events;
create trigger ad_events_bump
  after insert on public.ad_events
  for each row execute function public.bump_ad_counter();

-- ------------------------------------------------------------ ads bucket ----
-- Ad creatives are banners on public pages, so this bucket is public --
-- unlike identity-docs and payment-proofs. Only admins may write to it.
insert into storage.buckets (id, name, public)
values ('ads', 'ads', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'ads_public_read') then
    create policy ads_public_read on storage.objects
      for select using (bucket_id = 'ads');
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'ads_admin_write') then
    create policy ads_admin_write on storage.objects
      for insert with check (
        bucket_id = 'ads'
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;
end $$;

-- -------------------------------------------------------- imported tutors ---
-- An imported profile exists and is reachable by direct link, but is not the
-- platform vouching for anyone: it was typed in from a spreadsheet. It becomes
-- listable only when the tutor claims it (first login, terms incl. photo
-- consent, OTP-verified mobile) AND reaches 100% completion like everybody
-- else. Import never bypasses payment or verification rules.
alter table public.tutor_profiles add column if not exists imported boolean not null default false;
alter table public.tutor_profiles add column if not exists claimed_at timestamptz;
alter table public.tutor_profiles add column if not exists terms_accepted_at timestamptz;
alter table public.tutor_profiles add column if not exists imported_at timestamptz;
alter table public.tutor_profiles add column if not exists imported_by uuid references auth.users(id) on delete set null;

create index if not exists tutor_profiles_imported_idx
  on public.tutor_profiles (imported, claimed_at);

-- ------------------------------------------------------- tutor_directory ----
-- One more condition, and it reaches browse, ranking AND the sitemap at once:
-- rank_tutors() and listed_tutor_slugs() both read this view, so an unclaimed
-- import cannot leak into search through a path somebody forgot to update.
create or replace view public.tutor_directory as
  select
    tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
    tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
    tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
    tp.created_at, tp.gender, p.profile_completion
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  where p.profile_completion >= 100
    and tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status])
    and coalesce(p.is_suspended, false) = false
    and (tp.imported = false or tp.claimed_at is not null);

-- --------------------------------------------- direct-URL visibility --------
-- "Is this tutor listed?" and "may this URL render?" are two different
-- questions, and T7b is the first task where the answers differ.
--
-- tutor_directory answers the first: browse, rank_tutors() and the sitemap all
-- read it, and an unclaimed import must be in none of them.
--
-- But the import hands the tutor a link to their own profile over WhatsApp,
-- and that link has to work — otherwise the claim flow starts with a 404. So
-- this second view answers the second question: everything tutor_directory
-- has, PLUS unclaimed imports.
--
-- No grant to anon or authenticated. tutor_public_page() is SECURITY DEFINER
-- and runs as the owner, so the page still renders, and an unclaimed import
-- stays unreachable through a plain PostgREST query.
create or replace view public.tutor_visible_profiles as
  select
    tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
    tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
    tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
    tp.created_at, tp.gender, p.profile_completion
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  where tp.verification_status <> all (array['suspended'::verification_status, 'rejected'::verification_status])
    and coalesce(p.is_suspended, false) = false
    and (
      -- a listed tutor
      (p.profile_completion >= 100 and (tp.imported = false or tp.claimed_at is null = false))
      -- or an imported profile nobody has claimed yet
      or (tp.imported = true and tp.claimed_at is null)
    );

revoke all on public.tutor_visible_profiles from anon, authenticated;

-- Repoint the public profile page at it. Body unchanged except the FROM.
create or replace function public.tutor_public_page(p_slug text)
returns table(
  id uuid, slug text, full_name text, headline text, bio text, avatar_url text,
  city text, area text, teaching_mode text, online_platforms text[], gender text,
  hourly_rate_pkr integer, experience_years integer, degrees text[],
  video_youtube_id text, video_status text, rating_avg numeric, rating_count integer,
  created_at timestamptz, plan_code text, subjects jsonb, slots jsonb, reviews jsonb,
  degree_documents jsonb
)
language sql stable security definer
set search_path to 'public'
as $function$
  select
    d.id, d.slug, d.full_name, d.headline, d.bio, d.avatar_url, d.city, d.area,
    d.teaching_mode, d.online_platforms, d.gender, d.hourly_rate_pkr,
    d.experience_years, d.degrees,
    case when d.video_status = 'approved' then d.video_youtube_id end,
    d.video_status, d.rating_avg, d.rating_count, d.created_at,
    ap.plan_code,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'master_id', tm.id, 'category', cat.name,
               'level', lv.name, 'subject', sub.name
             ) order by cat.sort_order, lv.sort_order, sub.name)
      from tutor_subjects ts
      join taxonomy_master tm      on tm.id    = ts.master_id
      join taxonomy_categories cat on cat.slug = tm.category_slug
      join taxonomy_levels lv      on lv.slug  = tm.level_slug
      left join taxonomy_subjects sub on sub.slug = tm.subject_slug
      where ts.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', sl.id, 'text', sl.slot_text, 'booked', sl.is_booked)
                       order by sl.created_at)
      from tutor_slots sl where sl.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'rating', r.rating, 'comment', r.comment,
               'created_at', r.created_at,
               'reviewer', split_part(coalesce(rp.full_name, 'A parent'), ' ', 1)
             ) order by r.created_at desc)
      from reviews r
      left join profiles rp on rp.id = r.parent_id
      where r.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', ud.id, 'label', ud.label) order by ud.created_at)
      from user_documents ud
      where ud.user_id = d.id and ud.kind = 'degree' and ud.preview_path is not null
    ), '[]'::jsonb)
  from tutor_visible_profiles d
  left join (
    select distinct on (s.user_id) s.user_id, s.plan_code, pl.search_rank
    from subscriptions s
    join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
    where s.status = 'active' and s.expires_at > now()
    order by s.user_id, pl.search_rank desc, s.expires_at desc
  ) ap on ap.user_id = d.id
  where d.slug = p_slug;
$function$;
