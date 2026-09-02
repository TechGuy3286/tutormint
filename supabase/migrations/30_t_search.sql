-- T-Search — instant search everywhere.
--
-- One Postgres function behind one route. The platform has no search buttons
-- after this migration: every search input is a typeahead, and a typeahead
-- issues a request on a debounce rather than on a click.
--
-- Three things this function must never do, because it answers to anonymous
-- callers on public pages:
--
--   1. Return a contact field. Not a phone, not an email, not a WhatsApp
--      number. `tutor_directory` carries none, and the job branch selects
--      named columns rather than `*`, so a column added to `jobs` later
--      cannot silently start appearing in search results.
--   2. Return a tutor the directory would not list. The listing rule lives in
--      `tutor_directory` (100% completion, not suspended, not rejected, and
--      an unclaimed import excluded) and this function reads that view rather
--      than re-implementing the rule -- a second copy is a second thing to
--      forget to update.
--   3. Return a closed job. `status = 'open'` is checked here, not in the
--      caller.
--
-- SECURITY DEFINER, granted to service_role ONLY. The route rate-limits with
-- consume_rate_limit() before calling; granting EXECUTE to anon would put a
-- trigram scan one PostgREST call away from anybody with the publishable key
-- and leave the rate limit guarding a door with no wall attached.

begin;

-- ---------------------------------------------------------------- pg_trgm --
-- Supabase keeps extensions in `extensions`, not `public`; installing into
-- public here would put operator names in the same schema as the tables and
-- break `pg_dump --schema=public` restores.
create extension if not exists pg_trgm with schema extensions;

-- ------------------------------------------------------- taxonomy aliases --
-- Roman-Urdu and phonetic spellings, admin-editable.
--
-- Aliases attach to a taxonomy *slug*, not to a taxonomy_master id. "Physics"
-- appears in dozens of master rows (one per level); attaching "fizics" to the
-- subject slug once makes it findable at every level, where attaching it to
-- master ids would mean dozens of rows to maintain and one to forget.
create table if not exists public.taxonomy_aliases (
  id          serial primary key,
  kind        text not null check (kind in ('category', 'level', 'subject')),
  slug        text not null,
  alias       text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, slug, alias)
);

alter table public.taxonomy_aliases enable row level security;

-- Readable by nobody through the anon key: the search function is SECURITY
-- DEFINER and reads it on the caller's behalf. Admins manage the rows.
drop policy if exists taxonomy_aliases_admin_all on public.taxonomy_aliases;
create policy taxonomy_aliases_admin_all on public.taxonomy_aliases
  for all to authenticated
  using (public.is_admin_with(array['owner', 'manager']))
  with check (public.is_admin_with(array['owner', 'manager']));

-- A starter set. These are the spellings people actually type into a Pakistani
-- tutoring site; the admin can add more without a deploy.
insert into public.taxonomy_aliases (kind, slug, alias) values
  ('subject', 'physics',                   'fizics'),
  ('subject', 'physics',                   'physcis'),
  ('subject', 'physics',                   'phy'),
  ('subject', 'chemistry',                 'kemistry'),
  ('subject', 'chemistry',                 'chemestry'),
  ('subject', 'chemistry',                 'chem'),
  ('subject', 'biology',                   'bio'),
  ('subject', 'biology',                   'bailogy'),
  ('subject', 'mathematics',               'maths'),
  ('subject', 'mathematics',               'math'),
  ('subject', 'mathematics',               'riazi'),
  ('subject', 'mathematics',               'hisab'),
  ('subject', 'mathematics',               'mathmatics'),
  ('subject', 'english',                   'angrezi'),
  ('subject', 'english',                   'anghrezi'),
  ('subject', 'english',                   'eng'),
  ('subject', 'urdu',                      'urdo'),
  ('subject', 'islamiat-islamic-studies',  'islamiat'),
  ('subject', 'islamiat-islamic-studies',  'islamiyat'),
  ('subject', 'islamiat-islamic-studies',  'islamiyaat'),
  ('subject', 'islamic-studies',           'islamiat'),
  ('subject', 'computer-science',          'comp sci'),
  ('subject', 'computer-science',          'cs'),
  ('subject', 'computer-science',          'computer'),
  ('subject', 'accounting',                'accounts'),
  ('subject', 'accounting',                'accountancy'),
  ('subject', 'economics',                 'eco'),
  ('subject', 'economics',                 'econ'),
  ('subject', 'pakistan-studies',          'pak studies'),
  ('subject', 'pakistan-studies',          'pak std'),
  ('subject', 'statistics',                'stats')
on conflict (kind, slug, alias) do nothing;

-- ------------------------------------------------------- trigram indexes --
-- gin_trgm_ops supports both the similarity operator and ILIKE '%x%', which is
-- the pair of things this search does.
create index if not exists tutor_profiles_full_name_trgm
  on public.tutor_profiles using gin (full_name extensions.gin_trgm_ops);
create index if not exists tutor_profiles_headline_trgm
  on public.tutor_profiles using gin (headline extensions.gin_trgm_ops);
create index if not exists jobs_title_trgm
  on public.jobs using gin (title extensions.gin_trgm_ops);
create index if not exists taxonomy_subjects_name_trgm
  on public.taxonomy_subjects using gin (name extensions.gin_trgm_ops);
create index if not exists taxonomy_levels_name_trgm
  on public.taxonomy_levels using gin (name extensions.gin_trgm_ops);
create index if not exists taxonomy_categories_name_trgm
  on public.taxonomy_categories using gin (name extensions.gin_trgm_ops);
create index if not exists taxonomy_aliases_alias_trgm
  on public.taxonomy_aliases using gin (alias extensions.gin_trgm_ops);

commit;

-- ------------------------------------------------------------ the search --
begin;

-- One call, four groups. The caller renders only the groups that came back
-- with rows, so an empty group costs a few bytes rather than an empty heading.
--
-- Typo tolerance is deliberate and cheap: a prefix match scores 1.0, a
-- substring match 0.6, and anything else falls back to trigram similarity
-- above 0.3. That threshold is what makes "fizics" find Physics without
-- making one letter find everything.
create or replace function public.search_suggest(
  p_query text,
  p_city  text default null,
  p_limit integer default 5
) returns table (
  grp      text,
  ref      text,
  label    text,
  sublabel text,
  href     text,
  score    real
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  -- Hoisted into locals on purpose. As a SQL function this body referenced
  -- a scalar subquery on a one-row CTE about forty times, and each is a
  -- subquery the planner re-enters rather than a constant it folds: 127ms
  -- of pure overhead for a query whose every branch measures under 1ms.
  --
  -- The OUT parameters (grp, ref, label, ...) are plpgsql variables in here,
  -- so every column in the final SELECT is alias-qualified. Unqualified, they
  -- collide and Postgres refuses the function with "column reference is
  -- ambiguous".
  v_t text := lower(btrim(p_query));
  v_n integer := greatest(1, least(coalesce(p_limit, 5), 10));
begin
return query
with
-- Score the NAME tables, not the 896-row master table.
--
-- The obvious shape -- cross join every master row with every name it could be
-- known by, then score -- runs similarity() about 3,600 times per keystroke.
-- Scoring the four name tables first is roughly 540 comparisons, and the
-- trigram indexes can serve the ILIKE half of each one. Master rows are then
-- reached by joining to whatever matched, so a row nothing matched is never
-- scored at all.
 sub_hits as (
  select s.slug, (case
      when lower(s.name) like v_t || '%' then 1.0
      when lower(s.name) like '%' || v_t || '%' then 0.6
      else similarity(lower(s.name), v_t)
    end)::real as sc
  from taxonomy_subjects s
  where s.name ilike '%' || v_t || '%'
     or similarity(lower(s.name), v_t) > 0.3
),
lvl_hits as (
  select l.slug, (case
      when lower(l.name) like v_t || '%' then 1.0
      when lower(l.name) like '%' || v_t || '%' then 0.6
      else similarity(lower(l.name), v_t)
    end)::real as sc
  from taxonomy_levels l
  where l.name ilike '%' || v_t || '%'
     or similarity(lower(l.name), v_t) > 0.3
),
cat_hits as (
  select c.slug, (case
      when lower(c.name) like v_t || '%' then 1.0
      when lower(c.name) like '%' || v_t || '%' then 0.6
      else similarity(lower(c.name), v_t)
    end)::real as sc
  from taxonomy_categories c
  where c.name ilike '%' || v_t || '%'
     or similarity(lower(c.name), v_t) > 0.3
),
-- An alias scores as its target: somebody typing "fizics" wants Physics ranked
-- where Physics would rank, not demoted for having used the nickname.
alias_hits as (
  select a.kind, a.slug, (case
      when lower(a.alias) like v_t || '%' then 1.0
      when lower(a.alias) like '%' || v_t || '%' then 0.6
      else similarity(lower(a.alias), v_t)
    end)::real as sc
  from taxonomy_aliases a
  where a.alias ilike '%' || v_t || '%'
     or similarity(lower(a.alias), v_t) > 0.3
),
-- Fan the four hit sets out to master rows with plain joins, then take the
-- best score per row.
--
-- This was a `join lateral (... union all ...) on true` over taxonomy_master,
-- which reads correctly and is a trap: the lateral is correlated, so each of
-- the four branches re-scans its CTE once per master row -- about 3,600 CTE
-- scans per keystroke, and most of what this function used to cost. As plain
-- joins the planner hashes the small side once.
tax_hits as (
  select m.id, sh.sc from taxonomy_master m join sub_hits   sh on sh.slug = m.subject_slug
  union all
  select m.id, lh.sc from taxonomy_master m join lvl_hits   lh on lh.slug = m.level_slug
  union all
  select m.id, ch.sc from taxonomy_master m join cat_hits   ch on ch.slug = m.category_slug
  union all
  select m.id, ah.sc from taxonomy_master m join alias_hits ah
    on (ah.kind = 'subject'  and ah.slug = m.subject_slug)
    or (ah.kind = 'level'    and ah.slug = m.level_slug)
    or (ah.kind = 'category' and ah.slug = m.category_slug)
),
tax_best as (
  select th.id, max(th.sc) as sc from tax_hits th group by th.id
),
tax_scored as (
  select
    m.id,
    m.leaf_type,
    case when m.leaf_type = 'level' then l.name else s.name end as primary_name,
    l.name as level_name,
    c.name as category_name,
    c.sort_order as cat_order,
    l.sort_order as lvl_order,
    tb.sc
  from tax_best tb
  join taxonomy_master     m on m.id = tb.id
  join taxonomy_categories c on c.slug = m.category_slug
  join taxonomy_levels     l on l.slug = m.level_slug
  left join taxonomy_subjects s on s.slug = m.subject_slug
),
subjects as (
  select
    'subject'::text as grp,
    ts.id::text     as ref,
    ts.primary_name as label,
    case when ts.leaf_type = 'level'
         then ts.category_name
         else ts.level_name || ' - ' || ts.category_name end as sublabel,
    '/browse/tutors?subject=' || ts.id::text as href,
    ts.sc as score
  from tax_scored ts
  where ts.sc > 0.3
  -- "Physics" exists at a dozen levels and each is a different search. They
  -- are shown separately and ordered by the curriculum's own sequence, so the
  -- list is stable between keystrokes rather than reshuffling on ties.
  order by ts.sc desc, ts.cat_order, ts.lvl_order, ts.primary_name
  limit v_n
),
-- Cities and areas come from live data rather than lib/locations.ts, so a
-- place with nothing to show is never suggested. A suggestion that leads to an
-- empty page is worse than no suggestion at all.
places as (
  select distinct city as name, null::text as parent
    from tutor_directory where city is not null and city <> ''
  union
  select distinct area, city
    from tutor_directory where area is not null and area <> ''
  union
  select distinct city, null::text
    from jobs where status = 'open' and city is not null and city <> ''
),
locations as (
  select
    'location'::text as grp,
    p.name as ref,
    p.name as label,
    coalesce(p.parent, 'City') as sublabel,
    case when p.parent is null
         then '/browse/tutors?city=' || p.name
         else '/browse/tutors?city=' || p.parent || '&area=' || p.name end as href,
    (case
      when lower(p.name) like v_t || '%' then 1.0
      when lower(p.name) like '%' || v_t || '%' then 0.6
      else similarity(lower(p.name), v_t)
    end)::real as score
  from places p
  where p.name ilike '%' || v_t || '%'
     or similarity(lower(p.name), v_t) > 0.3
  order by score desc, length(p.name), p.name
  limit v_n
),
-- Named columns only. A `select *` here would publish whatever column lands
-- on tutor_directory next.
tutors as (
  select
    'tutor'::text as grp,
    d.slug as ref,
    d.full_name as label,
    coalesce(nullif(d.headline, ''), nullif(d.city, ''), 'Verified tutor') as sublabel,
    '/tutor/' || d.slug as href,
    (case
      when lower(d.full_name) like v_t || '%' then 1.0
      when lower(d.full_name) like '%' || v_t || '%' then 0.7
      when lower(coalesce(d.headline, '')) like '%' || v_t || '%' then 0.5
      else similarity(lower(d.full_name), v_t)
    end)::real as sc
  from tutor_directory d
  -- Prefilter so the trigram indexes are usable. Without it every listed
  -- tutor is scored on every keystroke, which is survivable at 16 tutors and
  -- not at 16,000.
  where d.slug is not null
    and (
      d.full_name ilike '%' || v_t || '%'
      or d.headline ilike '%' || v_t || '%'
      or similarity(lower(d.full_name), v_t) > 0.3
    )
  order by sc desc, d.is_featured desc nulls last, d.rating_avg desc nulls last
  limit v_n
),
jobs_hits as (
  select
    'job'::text as grp,
    j.id::text as ref,
    j.title as label,
    coalesce(nullif(j.city, ''), 'Tuition job') as sublabel,
    '/browse/tuitions?job=' || j.id::text as href,
    (case
      when lower(j.title) like v_t || '%' then 1.0
      when lower(j.title) like '%' || v_t || '%' then 0.7
      else similarity(lower(j.title), v_t)
    end)::real as sc
  from jobs j
  where j.status = 'open' and j.title is not null and j.title <> ''
    and (
      j.title ilike '%' || v_t || '%'
      or similarity(lower(j.title), v_t) > 0.3
    )
  order by sc desc, j.is_featured desc nulls last, j.created_at desc
  limit v_n
)
select sj.grp, sj.ref, sj.label, sj.sublabel, sj.href, sj.score from subjects sj
union all
select lo.grp, lo.ref, lo.label, lo.sublabel, lo.href, lo.score from locations lo
union all
select tu.grp, tu.ref, tu.label, tu.sublabel, tu.href, tu.sc from tutors tu where tu.sc > 0.3
union all
select jb.grp, jb.ref, jb.label, jb.sublabel, jb.href, jb.sc from jobs_hits jb where jb.sc > 0.3;
end;
$fn$;

revoke all on function public.search_suggest(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_suggest(text, text, integer) to service_role;

-- The empty-query state: what to offer before anybody has typed.
--
-- Popularity is measured by how many LISTED tutors actually teach the subject,
-- so the panel can never propose something with nothing behind it.
create or replace function public.popular_subjects(
  p_city  text default null,
  p_limit integer default 6
) returns table (
  ref      text,
  label    text,
  sublabel text,
  href     text
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $fn$
  select
    m.id::text,
    case when m.leaf_type = 'level' then l.name else s.name end,
    case when m.leaf_type = 'level' then c.name else l.name end,
    '/browse/tutors?subject=' || m.id::text
  from tutor_subjects tsub
  join tutor_directory d on d.id = tsub.tutor_id
  join taxonomy_master m on m.id = tsub.master_id
  join taxonomy_categories c on c.slug = m.category_slug
  join taxonomy_levels     l on l.slug = m.level_slug
  left join taxonomy_subjects s on s.slug = m.subject_slug
  where p_city is null or lower(d.city) = lower(p_city)
  group by m.id, m.leaf_type, s.name, l.name, c.name
  order by count(*) desc, coalesce(s.name, l.name)
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$fn$;

revoke all on function public.popular_subjects(text, integer) from public, anon, authenticated;
grant execute on function public.popular_subjects(text, integer) to service_role;

commit;
