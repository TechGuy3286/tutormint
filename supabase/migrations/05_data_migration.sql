-- 05_data_migration.sql
-- Copy rows from the legacy tables into the canonical ones.
--
-- Legacy tables are READ ONLY here. Nothing is dropped or renamed; that
-- happens in T8. Every row that cannot be mapped is logged to a _t1_* table
-- and skipped -- nothing is invented and no taxonomy row is created.
--
-- Idempotent: every insert is guarded by "where not exists" on the target, so
-- re-running adds nothing.

begin;

-- ---------------------------------------------------------------------------
-- Log tables (exported to .txt files after this migration runs)
-- ---------------------------------------------------------------------------
create table if not exists public._t1_unmatched_subjects (
  source_table text, source_id text, raw_value text, logged_at timestamptz not null default now()
);
create table if not exists public._t1_unmigrated_messages (
  message_id text, job_id text, sender text, recipient text, reason text,
  logged_at timestamptz not null default now()
);
create table if not exists public._t1_unmigrated_rows (
  source_table text, source_id text, reason text, logged_at timestamptz not null default now()
);

truncate public._t1_unmatched_subjects, public._t1_unmigrated_messages, public._t1_unmigrated_rows;

-- Parse "25,000 PKR / mo" -> 25000, "2500 PKR" -> 2500, null -> null.
create or replace function public._t1_money_to_int(v text)
returns integer language sql immutable as $fn$
  select nullif(regexp_replace(coalesce(substring(v from '[0-9][0-9,]*'), ''), '[^0-9]', '', 'g'), '')::integer
$fn$;

-- ---------------------------------------------------------------------------
-- 1. parents + parent_profiles -> profiles
-- ---------------------------------------------------------------------------
insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'parents', p.user_id::text, 'no matching auth.users row'
from public.parents p left join auth.users u on u.id = p.user_id where u.id is null;

-- profiles.email is NOT NULL and neither legacy table carries an email, so it
-- comes from the joined auth.users row.
insert into public.profiles (id, role, account_type, full_name, email, phone_number, whatsapp, city, created_at)
select p.user_id, 'parent'::user_role, 'parent', p.full_name, u.email, p.phone, p.whatsapp, p.city, p.created_at
from public.parents p
join auth.users u on u.id = p.user_id
where u.email is not null
  and not exists (select 1 from public.profiles pr where pr.id = p.user_id);

insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'parent_profiles', pp.id::text, 'no matching auth.users row'
from public.parent_profiles pp left join auth.users u on u.id = pp.id where u.id is null;

insert into public.profiles (id, role, account_type, full_name, email, phone_number, city, cnic_number, avatar_url)
select pp.id, 'parent'::user_role, 'parent', pp.full_name, u.email, pp.phone, pp.city, pp.cnic_number,
       coalesce(pp.avatar_url, pp.profile_picture)
from public.parent_profiles pp
join auth.users u on u.id = pp.id
where u.email is not null
  and not exists (select 1 from public.profiles pr where pr.id = pp.id);

-- Backfill columns on profiles rows that already existed but are missing data.
update public.profiles pr
set full_name    = coalesce(pr.full_name, pp.full_name),
    phone_number = coalesce(pr.phone_number, pp.phone),
    city         = coalesce(pr.city, pp.city),
    cnic_number  = coalesce(pr.cnic_number, pp.cnic_number),
    avatar_url   = coalesce(pr.avatar_url, pp.avatar_url, pp.profile_picture)
from public.parent_profiles pp
where pp.id = pr.id;

-- ---------------------------------------------------------------------------
-- 2. tutors -> tutor_profiles (where missing)
-- ---------------------------------------------------------------------------
insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'tutors', t.user_id::text, 'no matching auth.users row (tutor_profiles.id has an FK to auth.users)'
from public.tutors t left join auth.users u on u.id = t.user_id where u.id is null;

-- tutor_profiles.email is NOT NULL and tutors has no email column, so it comes
-- from the joined auth.users row.
insert into public.tutor_profiles (
  id, full_name, email, phone_number, whatsapp_number, city, area, area_name,
  headline, bio, avatar_url, hourly_rate_pkr, rating_avg, rating_count,
  verification_status, degrees, created_at
)
select
  t.user_id, t.full_name, u.email, t.phone, t.whatsapp, t.city, t.area, t.area,
  coalesce(t.headline, t.title), t.bio, t.avatar_url,
  public._t1_money_to_int(t.hourly_rate),
  coalesce(t.rating, 0), coalesce(t.reviews_count, 0),
  case when t.is_verified then 'verified'::verification_status
       else 'pending'::verification_status end,
  case when t.degree is null or btrim(t.degree) = '' then '{}'::text[]
       else array[btrim(t.degree)] end,
  t.created_at
from public.tutors t
join auth.users u on u.id = t.user_id
where u.email is not null
  and not exists (select 1 from public.tutor_profiles tp where tp.id = t.user_id);

-- ---------------------------------------------------------------------------
-- 3. parent_jobs + tuitions -> jobs
-- ---------------------------------------------------------------------------
insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'parent_jobs', j.id::text, 'parent_id has no matching auth.users row (jobs.parent_id has an FK)'
from public.parent_jobs j left join auth.users u on u.id = j.parent_id where u.id is null;

-- The legacy columns on jobs (subject, grade, budget) are still NOT NULL and
-- are not dropped until T8, so they are carried across verbatim alongside the
-- canonical subjects/class_level/budget_pkr.
insert into public.jobs (
  id, job_tx_id, parent_id, title, subjects, class_level, city, area,
  budget_pkr, description, status, created_at,
  subject, grade, budget, timings
)
select
  gen_random_uuid(), j.job_tx_id, j.parent_id, j.title,
  case when j.subject is null then null
       else (select array_agg(btrim(x)) from unnest(string_to_array(j.subject, ',')) x
             where btrim(x) <> '') end,
  j.grade, j.city, coalesce(j.area, j.location, ''),
  public._t1_money_to_int(j.budget), j.description,
  case lower(coalesce(j.status, '')) when 'active' then 'open'
                                     when 'closed' then 'closed'
                                     when 'hired'  then 'hired'
                                     else 'open' end,
  j.created_at,
  -- Legacy NOT NULL columns with no nullable source. parent_jobs has no
  -- timings column at all, so it is filled with '' rather than invented.
  coalesce(j.subject, ''), coalesce(j.grade, ''), coalesce(j.budget, ''), ''
from public.parent_jobs j
join auth.users u on u.id = j.parent_id
where j.job_tx_id is not null
  and not exists (select 1 from public.jobs g where g.job_tx_id = j.job_tx_id);

-- tuitions has no parent/owner column at all, so its rows cannot satisfy
-- jobs.parent_id (NOT NULL, FK to auth.users). Logged rather than invented.
insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'tuitions', t.id::text, 'tuitions has no parent/owner column; jobs.parent_id cannot be derived'
from public.tuitions t;

-- ---------------------------------------------------------------------------
-- 4. tutor_applications + tuition_applications -> applications
-- ---------------------------------------------------------------------------
insert into public.applications (job_id, tutor_id, status, created_at)
select g.id, ta.tutor_user_id,
       case lower(coalesce(ta.status,'')) when 'accepted' then 'hired'
                                          when 'rejected' then 'rejected'
                                          when 'shortlisted' then 'shortlisted'
                                          else 'applied' end,
       ta.created_at
from public.tutor_applications ta
join public.jobs g on g.job_tx_id = ta.job_tx_id
join auth.users u on u.id = ta.tutor_user_id
where not exists (
  select 1 from public.applications a where a.job_id = g.id and a.tutor_id = ta.tutor_user_id
);

insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'tutor_applications', ta.id::text,
       'no jobs row with job_tx_id=' || coalesce(ta.job_tx_id,'(null)') ||
       ', or tutor_user_id not in auth.users'
from public.tutor_applications ta
where not exists (
  select 1 from public.jobs g join auth.users u on u.id = ta.tutor_user_id
  where g.job_tx_id = ta.job_tx_id
);

-- tuition_applications keys on tuition_id and tutor_email. Resolve the tutor by
-- email; the job only resolves if a jobs row carries that id as job_tx_id.
insert into public.applications (job_id, tutor_id, status, created_at)
select g.id, u.id,
       case lower(coalesce(ta.status,'')) when 'accepted' then 'hired'
                                          when 'rejected' then 'rejected'
                                          else 'applied' end,
       ta.created_at
from public.tuition_applications ta
join auth.users u on lower(u.email) = lower(ta.tutor_email)
join public.jobs g on g.job_tx_id = ta.tuition_id
where not exists (
  select 1 from public.applications a where a.job_id = g.id and a.tutor_id = u.id
);

insert into public._t1_unmigrated_rows (source_table, source_id, reason)
select 'tuition_applications', ta.id::text,
       case when u.id is null then 'tutor_email not found in auth.users: ' || coalesce(ta.tutor_email,'(null)')
            else 'no jobs row matches tuition_id=' || coalesce(ta.tuition_id,'(null)') end
from public.tuition_applications ta
left join auth.users u on lower(u.email) = lower(ta.tutor_email)
where not exists (select 1 from public.jobs g where g.job_tx_id = ta.tuition_id)
   or u.id is null;

-- ---------------------------------------------------------------------------
-- 5. job_messages -> threads + messages
-- ---------------------------------------------------------------------------
insert into public.threads (job_id, participant_a, participant_b, initiated_by, created_at)
select distinct g.id, g.parent_id, jm.sender_id, jm.sender_id, min(jm.created_at) over (partition by g.id, jm.sender_id)
from public.job_messages jm
join public.jobs g on g.job_tx_id = jm.job_tx_id
join auth.users u on u.id = jm.sender_id
where jm.sender_id <> g.parent_id
  and not exists (
    select 1 from public.threads th
    where th.job_id = g.id
      and th.participant_a = g.parent_id and th.participant_b = jm.sender_id
  );

-- messages still has legacy NOT NULL columns (job_id, sender, recipient,
-- message) until T8, so they are filled alongside the canonical ones.
insert into public.messages (thread_id, sender_id, body, created_at,
                             job_id, sender, recipient, message)
select th.id, jm.sender_id, jm.message, jm.created_at,
       jm.job_tx_id, jm.sender_id::text,
       case when th.participant_a = jm.sender_id then th.participant_b::text
            else th.participant_a::text end,
       jm.message
from public.job_messages jm
join public.jobs g on g.job_tx_id = jm.job_tx_id
join public.threads th on th.job_id = g.id
     and (th.participant_a = jm.sender_id or th.participant_b = jm.sender_id)
where not exists (
  select 1 from public.messages m
  where m.thread_id = th.id and m.sender_id = jm.sender_id
    and m.body = jm.message and m.created_at = jm.created_at
);

insert into public._t1_unmigrated_messages (message_id, job_id, sender, recipient, reason)
select jm.id::text, jm.job_tx_id, jm.sender_id::text, null,
       'no jobs row with that job_tx_id, or sender_id not in auth.users'
from public.job_messages jm
where not exists (
  select 1 from public.jobs g join auth.users u on u.id = jm.sender_id
  where g.job_tx_id = jm.job_tx_id
);

-- Pre-existing rows in the canonical messages table store sender/recipient as
-- free text (an email or a display name), not uuids. Resolve sender by email
-- where possible and copy the body across; a thread needs BOTH participants,
-- so any row whose recipient does not resolve is logged and left alone.
update public.messages m
set sender_id = u.id
from auth.users u
where m.sender_id is null and m.sender is not null
  and lower(u.email) = lower(m.sender);

update public.messages
set body = message
where body is null and message is not null;

insert into public._t1_unmigrated_messages (message_id, job_id, sender, recipient, reason)
select m.id::text, m.job_id, m.sender, m.recipient,
       case
         when m.sender_id is null then 'sender "' || coalesce(m.sender,'(null)') ||
              '" is not a uuid and does not match any auth.users email'
         else 'recipient "' || coalesce(m.recipient,'(null)') ||
              '" is a display name, not a uuid or a known email; no thread can be formed'
       end
from public.messages m
where m.thread_id is null;

-- ---------------------------------------------------------------------------
-- 6. subject text -> tutor_subjects / job_subjects (exact name match only)
-- ---------------------------------------------------------------------------

-- Tutors: tutors.subjects / tutors.subject are comma-separated free text.
with toks as (
  select t.user_id as tutor_id, btrim(x) as raw
  from public.tutors t
  join auth.users u on u.id = t.user_id
  cross join lateral unnest(string_to_array(coalesce(t.subjects, t.subject, ''), ',')) x
  where btrim(x) <> ''
)
insert into public.tutor_subjects (tutor_id, subject_slug)
select distinct k.tutor_id, s.slug
from toks k join public.taxonomy_subjects s on lower(s.name) = lower(k.raw)
where not exists (
  select 1 from public.tutor_subjects ts
  where ts.tutor_id = k.tutor_id and ts.subject_slug = s.slug
);

with toks as (
  select t.user_id as tutor_id, btrim(x) as raw
  from public.tutors t
  join auth.users u on u.id = t.user_id
  cross join lateral unnest(string_to_array(coalesce(t.subjects, t.subject, ''), ',')) x
  where btrim(x) <> ''
)
insert into public._t1_unmatched_subjects (source_table, source_id, raw_value)
select distinct 'tutors', k.tutor_id::text, k.raw
from toks k
where not exists (select 1 from public.taxonomy_subjects s where lower(s.name) = lower(k.raw));

-- Jobs: jobs.subjects is text[] as loaded above.
with toks as (
  select g.id as job_id, btrim(x) as raw
  from public.jobs g cross join lateral unnest(coalesce(g.subjects, '{}')) x
  where btrim(x) <> ''
)
insert into public.job_subjects (job_id, subject_slug)
select distinct k.job_id, s.slug
from toks k join public.taxonomy_subjects s on lower(s.name) = lower(k.raw)
where not exists (
  select 1 from public.job_subjects js
  where js.job_id = k.job_id and js.subject_slug = s.slug
);

with toks as (
  select g.id as job_id, btrim(x) as raw
  from public.jobs g cross join lateral unnest(coalesce(g.subjects, '{}')) x
  where btrim(x) <> ''
)
insert into public._t1_unmatched_subjects (source_table, source_id, raw_value)
select distinct 'jobs', k.job_id::text, k.raw
from toks k
where not exists (select 1 from public.taxonomy_subjects s where lower(s.name) = lower(k.raw));

commit;
