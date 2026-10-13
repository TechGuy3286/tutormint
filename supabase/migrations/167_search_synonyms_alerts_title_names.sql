-- 167_search_synonyms_alerts_title_names.sql
--
-- Smart tutor search and the blog title queue (owner, 13 Oct 2026). Additive.
--
--   1. taxonomy_levels.title_name / taxonomy_subjects.title_name — the short
--      name a suggested blog TITLE uses ("FA", "Maths"). Optional; the taxonomy
--      name, the pickers and every saved row are untouched.
--   2. More Search words (taxonomy_aliases — the existing, admin-editable
--      synonyms table). One word may now mean SEVERAL subjects: "computer" →
--      Computer Science, ICT, Information Technology, Programming, Coding,
--      Computer Skills. Existing words are kept; nothing is removed.
--   3. tutor_search_alerts — "Notify me when a matching tutor joins". One
--      message, then the request is closed; it lapses after 60 days. The
--      contact is given with an explicit opt-in and is used for nothing else.
--   4. search_unmet_done.kind — why a search left "To review": done, or ignored.
--
-- Idempotent.

-- 1 ------------------------------------------------------------ title names
alter table public.taxonomy_levels add column if not exists title_name text;
alter table public.taxonomy_subjects add column if not exists title_name text;

-- 2 ------------------------------------------------------------ search words
insert into public.taxonomy_aliases (kind, slug, alias)
select v.kind, v.slug, v.alias
from (
  values
    -- computer → every computing subject
    ('subject', 'computer-science', 'computer'),
    ('subject', 'ict', 'computer'),
    ('subject', 'information-technology', 'computer'),
    ('subject', 'information-technology-ict', 'computer'),
    ('subject', 'programming', 'computer'),
    ('subject', 'computer-programming', 'computer'),
    ('subject', 'coding', 'computer'),
    ('subject', 'computer-skills', 'computer'),
    ('subject', 'computer-science', 'computers'),
    ('subject', 'information-technology', 'it'),
    ('subject', 'information-technology-ict', 'it'),
    ('subject', 'ict', 'it'),
    ('subject', 'computer-skills', 'ms office'),
    ('subject', 'computer-skills', 'office'),
    ('subject', 'programming', 'coding'),
    ('subject', 'computer-programming', 'coding'),
    ('subject', 'coding', 'programming'),
    ('subject', 'computer-programming', 'programming'),
    -- everyday short forms
    ('subject', 'mathematics', 'math'),
    ('subject', 'mathematics', 'maths'),
    ('subject', 'biology', 'bio'),
    ('subject', 'chemistry', 'chem'),
    ('subject', 'physics', 'phy'),
    ('subject', 'english', 'eng'),
    ('subject', 'islamiat-islamic-studies', 'islamiyat'),
    ('subject', 'islamiat-islamic-studies', 'islamiat'),
    ('subject', 'pakistan-studies', 'pak studies'),
    -- Quran
    ('subject', 'nazra-quran', 'quran'),
    ('subject', 'quran-studies', 'quran'),
    ('subject', 'x80s-hifzul-quran', 'quran'),
    ('subject', 'quran-translation', 'quran'),
    ('subject', 'nazra-quran', 'nazra'),
    ('subject', 'nazra-quran', 'tajweed'),
    ('subject', 'x80s-hifzul-quran', 'hifz'),
    ('subject', 'x80s-hifzul-quran', 'hifz quran'),
    -- levels
    ('level', 'x80g-12', 'ssc'), ('level', 'x80g-13', 'ssc'), ('level', 'x80g-14', 'ssc'), ('level', 'x80g-15', 'ssc'),
    ('level', 'x80g-19', 'hssc'), ('level', 'x80g-20', 'hssc'), ('level', 'x95g-ics', 'hssc'), ('level', 'x95g-i-com', 'hssc'),
    ('level', 'x80g-17', 'o-level'), ('level', 'x80g-17', 'gce o level'),
    ('level', 'x80g-18', 'a-level'), ('level', 'x80g-18', 'gce a level'),
    ('level', 'x80g-16', 'igcse')
) as v(kind, slug, alias)
where (
    (v.kind = 'subject' and exists (select 1 from public.taxonomy_subjects s where s.slug = v.slug))
    or (v.kind = 'level' and exists (select 1 from public.taxonomy_levels l where l.slug = v.slug))
  )
  and not exists (
    select 1 from public.taxonomy_aliases a where a.kind = v.kind and a.slug = v.slug and lower(a.alias) = lower(v.alias)
  );

-- 3 ----------------------------------------------------------- notify me
create table if not exists public.tutor_search_alerts (
  id uuid primary key default gen_random_uuid(),
  -- How the parent asked to be told: one SMS, or one email.
  channel text not null check (channel in ('sms', 'email')),
  -- A Pakistani mobile as 92XXXXXXXXXX, or an email address.
  contact text not null,
  -- The parent ticked "Send me one message when a tutor matching this search joins".
  consent_at timestamptz not null default now(),
  -- What was searched, as the filters the match is made on.
  query text,
  city text,
  area text,
  master_ids int[] not null default '{}',
  -- The search in words, for the message ("O Level Physics tutor in Lahore").
  label text not null default '',
  -- Tutors who already matched when the request was made — never "new".
  known_tutor_ids uuid[] not null default '{}',
  user_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days'),
  -- Set when the one message was sent; the request is then closed.
  notified_at timestamptz,
  matched_tutor_id uuid,
  closed_at timestamptz,
  close_reason text check (close_reason in ('notified', 'expired', 'send_failed'))
);

create index if not exists tutor_search_alerts_open_idx on public.tutor_search_alerts (created_at) where closed_at is null;
-- One open request per contact per search.
create unique index if not exists tutor_search_alerts_open_uniq
  on public.tutor_search_alerts (lower(contact), lower(coalesce(city, '')), lower(coalesce(label, '')))
  where closed_at is null;

alter table public.tutor_search_alerts enable row level security;

do $$
begin
  -- A contact is personal: staff read, the server writes; nobody else.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tutor_search_alerts' and policyname = 'tutor_search_alerts_admin_read') then
    create policy tutor_search_alerts_admin_read on public.tutor_search_alerts for select using (public.is_admin());
  end if;
end
$$;

grant select on public.tutor_search_alerts to authenticated;
grant all on public.tutor_search_alerts to service_role;

-- 4 ------------------------------------------------- unmet: done or ignored
alter table public.search_unmet_done add column if not exists kind text not null default 'done';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'search_unmet_done_kind_check') then
    alter table public.search_unmet_done add constraint search_unmet_done_kind_check check (kind in ('done', 'ignored', 'synonym', 'subject'));
  end if;
end
$$;
