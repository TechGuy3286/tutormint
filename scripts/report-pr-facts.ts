/**
 * scripts/report-pr-facts.ts — read-only facts for the 13 Oct 2026 PR.
 * Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-pr-facts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label: string, sql: string) => {
    const { rows } = await c.query(sql)
    console.log(`\n## ${label}`)
    for (const r of rows) console.log(JSON.stringify(r))
  }
  await q(
    'open tuitions by age (days since posted / resumed)',
    `select count(*)::int as open,
            count(*) filter (where now() - coalesce(resumed_at, created_at) >= interval '15 days')::int as past_15,
            count(*) filter (where now() - coalesce(resumed_at, created_at) >= interval '12 days' and now() - coalesce(resumed_at, created_at) < interval '15 days')::int as due_within_3_days,
            count(*) filter (where now() - coalesce(resumed_at, created_at) >= interval '7 days')::int as past_7
       from jobs where status = 'open'`,
  )
  await q('paused tuitions by source', `select coalesce(pause_source, '(none)') as source, count(*)::int as n from jobs where status = 'paused' group by 1 order by 2 desc`)
  await q('indexing queue waiting', `select kind, count(*)::int as n from indexing_queue where sent_at is null group by 1`)
  await q('staff', `select full_name, admin_role, is_suspended from profiles where role = 'admin' order by admin_role`)
  await q(
    'subjects that read as Quran / computer',
    `select s.slug, s.name from taxonomy_subjects s
      where (s.name ~* 'quran|nazra|tajweed|hifz|qaida' or s.name ~* '^(computer science|ict|programming|coding|computer skills|computer programming|information technology)')
        and exists (select 1 from taxonomy_master m join taxonomy_levels l on l.slug = m.level_slug where m.subject_slug = s.slug and not l.legacy)
      order by s.name`,
  )
  await q('live levels', `select l.slug, l.name, c.name as category from taxonomy_levels l join taxonomy_categories c on c.slug = l.category_slug where not l.legacy order by c.sort_order, l.sort_order`)
  await q('search words on file', `select kind, count(*)::int as n from taxonomy_aliases group by 1`)
  await q('rank_tutors area match present', `select count(*)::int as fns, bool_or(position('lower(a) = lower(p_area)' in pg_get_functiondef(p.oid)) > 0) as has_needle from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rank_tutors'`)
  await q('storage write policies that exclude the Partner', `select count(*)::int as n from pg_policies where schemaname = 'storage' and (coalesce(qual,'') || coalesce(with_check,'')) like '%partner%'`)
  await q('content suggestions by status', `select card, status, count(*)::int as n from content_suggestions group by 1, 2 order by 1, 2`)
  await q('posts', `select status, cluster, title from posts order by status, created_at`)
  await q('templates that mention 7 days', `select key from admin_message_templates where body ~* '7 days|seven days|7 دن|سات دن'`)
  await c.end()
}

void main()
