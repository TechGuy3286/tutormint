-- 193_applications_v2.sql  (owner, 22 Oct 2026)
--
-- Applications v2. Additive and re-runnable; nothing is deleted.
--
-- 1. applications.worked_at / worked_by / worked_by_name — the last time staff
--    (or the parent, through the site's own hire flow) did something with the
--    application: a stage change, a WhatsApp check-in tap, or forwarding it to
--    the parent. A worked application sinks to the bottom of its tuition group
--    on Admin → Applications until it is overdue again (the 1-day / 3-day rules
--    are counted from the last activity). Service-role writes only: the stage
--    guard (migration 192) now also refuses these columns to a signed-in token.
--    Backfill: an application whose stage was set by staff is worked as of that
--    stage change.
--
-- 2. tuition_owners.posted_by — the staff member who POSTED the tuition, which
--    never changes when the owner is reassigned. Backfilled from the poster
--    rows. source may also be 'city' (assigned by the city-owner rule).
--
-- 3. city_owners — the staff member who owns each city's tuitions that no staff
--    member posted. Only the site Owner edits it (server route, audited).
--    Admin-read RLS, service-role writes. Seeded from the owner's list: a name
--    is used only when it matches exactly ONE staff account (an exact full name,
--    else the whole first word(s) of one name); otherwise the city stays
--    unmapped. Removing a city owner sets staff_id null (the row is kept).
--
-- The assignment of existing unowned tuitions to their city owner is done by
-- scripts/apply-migration-193.ts in the same transaction, with one audit row
-- per tuition (lib/cityOwnersCore is the rule).

-- 1 -----------------------------------------------------------------------------
alter table public.applications
  add column if not exists worked_at timestamptz,
  add column if not exists worked_by uuid references auth.users(id) on delete set null,
  add column if not exists worked_by_name text;

update public.applications
   set worked_at = stage_changed_at,
       worked_by = stage_changed_by,
       worked_by_name = stage_changed_by_name
 where worked_at is null
   and stage_changed_by is not null
   and stage_changed_at is not null;

create or replace function public.guard_application_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.stage is distinct from old.stage
     or new.stage_changed_at is distinct from old.stage_changed_at
     or new.stage_changed_by is distinct from old.stage_changed_by
     or new.stage_changed_by_name is distinct from old.stage_changed_by_name
     or new.worked_at is distinct from old.worked_at
     or new.worked_by is distinct from old.worked_by
     or new.worked_by_name is distinct from old.worked_by_name then
    raise exception 'The application stage is changed by TutorMint staff only.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_application_stage() from public;

-- 2 -----------------------------------------------------------------------------
alter table public.tuition_owners
  add column if not exists posted_by uuid references auth.users(id) on delete set null;

update public.tuition_owners
   set posted_by = staff_id
 where posted_by is null
   and source = 'poster'
   and staff_id is not null;

create index if not exists tuition_owners_posted_by_idx on public.tuition_owners (posted_by);

alter table public.tuition_owners drop constraint if exists tuition_owners_source_check;
alter table public.tuition_owners add constraint tuition_owners_source_check
  check (source in ('poster', 'reassigned', 'city'));

-- 3 -----------------------------------------------------------------------------
create table if not exists public.city_owners (
  city             text primary key,
  staff_id         uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  updated_by_name  text,
  updated_at       timestamptz not null default now()
);

alter table public.city_owners enable row level security;
drop policy if exists city_owners_admin_read on public.city_owners;
create policy city_owners_admin_read on public.city_owners
  for select using (public.is_admin());

with seed(name, city) as (
  values
    ('Zubia Bashir', 'Peshawar'), ('Zubia Bashir', 'Mardan'), ('Zubia Bashir', 'Abbottabad'), ('Zubia Bashir', 'Quetta'),
    ('Mahnoor Amin', 'Hyderabad'), ('Mahnoor Amin', 'Sukkur'), ('Mahnoor Amin', 'Larkana'), ('Mahnoor Amin', 'Sargodha'),
    ('Mahnoor Amin', 'Bahawalpur'), ('Mahnoor Amin', 'Gujrat'),
    ('Nabeel', 'Islamabad'), ('Nabeel', 'Rawalpindi'),
    ('Inzamam', 'Multan'), ('Inzamam', 'Rahim Yar Khan'),
    ('Aseer Ul Hassan', 'Faisalabad'), ('Aseer Ul Hassan', 'Gujranwala'), ('Aseer Ul Hassan', 'Sialkot'),
    ('Aseer Ul Hassan', 'Sheikhupura'), ('Aseer Ul Hassan', 'Jhang'),
    ('Khizra Danish', 'Karachi'),
    ('Aqsa Mughal', 'Lahore')
),
staff as (
  select id, lower(regexp_replace(trim(coalesce(full_name, '')), '\s+', ' ', 'g')) as n
    from public.profiles
   where role = 'admin' and admin_role is not null and not coalesce(is_suspended, false)
),
names as (select distinct name, lower(regexp_replace(trim(name), '\s+', ' ', 'g')) as want from seed),
exact as (
  select nm.name, s.id, count(*) over (partition by nm.name) as k
    from names nm join staff s on s.n = nm.want
),
prefix as (
  select nm.name, s.id, count(*) over (partition by nm.name) as k
    from names nm join staff s on s.n like nm.want || ' %'
   where not exists (select 1 from staff e where e.n = nm.want)
),
matched as (
  select name, id from exact where k = 1
  union all
  select name, id from prefix where k = 1
)
insert into public.city_owners (city, staff_id, updated_by_name)
select sd.city, m.id, 'system: city owners seed'
  from seed sd
  join matched m on m.name = sd.name
on conflict (city) do nothing;
