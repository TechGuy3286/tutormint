/**
 * scripts/report-search-log.ts — read-only (owner, 13 Oct 2026).
 * Who made the searches of the last 30 days: members (by role), anonymous
 * visitors (by session), and unmet searches. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-search-log.ts
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
    'member searches (tutors surface) by role, 30 days',
    `select coalesce(p.role::text, '(gone)') as role, coalesce(p.admin_role, '') as admin_role, coalesce(p.is_test_name, false) or coalesce(p.hidden_from_public, false) as test,
            count(*)::int as n, count(distinct l.user_id)::int as members
       from user_activity_log l left join profiles p on p.id = l.user_id
      where l.event = 'search_performed' and l.created_at > now() - interval '30 days' and l.meta->>'surface' = 'tutors'
      group by 1, 2, 3 order by 4 desc`,
  )
  await q(
    'top member searchers (tutors surface)',
    `select left(l.user_id::text, 8) as uid, p.role::text as role, p.admin_role, p.full_name, count(*)::int as n,
            count(*) filter (where l.meta->>'master_id' is not null and l.meta->>'city' is not null)::int as with_subject_city,
            min(l.created_at)::date as first, max(l.created_at)::date as last
       from user_activity_log l left join profiles p on p.id = l.user_id
      where l.event = 'search_performed' and l.created_at > now() - interval '30 days' and l.meta->>'surface' = 'tutors'
      group by 1, 2, 3, 4 order by 5 desc limit 12`,
  )
  await q(
    'anonymous searches (tutors surface), 30 days',
    `select count(*)::int as n, count(distinct session_id)::int as sessions,
            count(*) filter (where master_id is not null and city is not null)::int as with_subject_city
       from anon_search_events where surface = 'tutors' and created_at > now() - interval '30 days'`,
  )
  await q(
    'top anonymous sessions',
    `select left(session_id, 8) as session, count(*)::int as n, count(distinct (master_id, city))::int as combos,
            min(created_at) as first, max(created_at) as last
       from anon_search_events where surface = 'tutors' and created_at > now() - interval '30 days'
      group by 1 order by 2 desc limit 10`,
  )
  await q(
    'anonymous searches by hour, busiest',
    `select date_trunc('hour', created_at) as hour, count(*)::int as n, count(distinct session_id)::int as sessions
       from anon_search_events where surface = 'tutors' and created_at > now() - interval '30 days'
      group by 1 order by 2 desc limit 10`,
  )
  await q(
    'one recruitment combo, every search behind it (Lahore, Grade 2 Robotics = master 3338)',
    `select 'member' as src, left(l.user_id::text, 8) as who, p.role::text as role, p.admin_role, l.created_at
       from user_activity_log l left join profiles p on p.id = l.user_id
      where l.event = 'search_performed' and l.created_at > now() - interval '30 days' and l.meta->>'master_id' = '3338' and lower(l.meta->>'city') = 'lahore'
     union all
     select 'anon', left(session_id, 8), null, null, created_at from anon_search_events
      where created_at > now() - interval '30 days' and master_id = 3338 and lower(city) = 'lahore'
      order by 5`,
  )
  await q('unmet searches, 30 days', `select coalesce(role, '(guest)') as role, is_test, count(*)::int as n from search_unmet where created_at > now() - interval '30 days' group by 1, 2 order by 3 desc`)
  await q('recruitment cards', `select status, coalesce(dismiss_reason, '') as reason, count(*)::int as n from content_suggestions where card = 'recruitment' group by 1, 2`)
  await c.end()
}

void main()
