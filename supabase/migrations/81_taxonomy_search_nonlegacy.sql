-- 81_taxonomy_search_nonlegacy.sql — the browse typeahead / popular
-- suggestions must not offer retired taxonomy (owner, 13 Sep 2026).
--
-- Migration 80 replaced the taxonomy and flagged every prior level legacy. The
-- cascade selects on the browse bars already read only non-legacy rows (lib/
-- taxonomy), but search_suggest() and popular_subjects() scanned taxonomy_master
-- with no legacy filter, so a retired subject could still be suggested and
-- resolve to a retired master_id. Both are recreated from their live definitions
-- with a single added filter: the master's level must be non-legacy. Nothing
-- else changed — the bodies are the live functions verbatim.

begin;

CREATE OR REPLACE FUNCTION public.search_suggest(p_query text, p_city text DEFAULT NULL::text, p_limit integer DEFAULT 5)
 RETURNS TABLE(grp text, ref text, label text, sublabel text, href text, score real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  select th.id, max(th.sc) as sc from tax_hits th
   join taxonomy_master m_nl on m_nl.id = th.id
   join taxonomy_levels l_nl on l_nl.slug = m_nl.level_slug
   where not l_nl.legacy
   group by th.id
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
$function$
;

CREATE OR REPLACE FUNCTION public.popular_subjects(p_city text DEFAULT NULL::text, p_limit integer DEFAULT 6)
 RETURNS TABLE(ref text, label text, sublabel text, href text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  where (p_city is null or lower(d.city) = lower(p_city)) and not l.legacy
  group by m.id, m.leaf_type, s.name, l.name, c.name
  order by count(*) desc, coalesce(s.name, l.name)
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$function$
;

commit;
