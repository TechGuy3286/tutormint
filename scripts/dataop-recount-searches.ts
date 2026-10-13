/**
 * scripts/dataop-recount-searches.ts — one-time (owner, 13 Oct 2026).
 *
 * 1. Applies migration 168 (anon_search_events.excluded — additive).
 * 2. Recounts the anonymous search log with the new rules
 *    (lib/searchCountCore.recountAnon): a visitor seen exactly once is a crawler
 *    or a cookieless first request ('first_hit'); the identical search by one
 *    visitor inside 30 minutes is a 'repeat'. Rows are FLAGGED, never deleted.
 * 3. Dismisses every open recruitment card with the reason
 *    "made by link-check crawl" (status 'dismissed' — never deleted). A card
 *    whose clean count still earns it comes back on the next queue rebuild.
 *
 * Prints before → after. Without --apply everything is rolled back.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-recount-searches.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { recountAnon, repeatIds, type LoggedSearch } from '../lib/searchCountCore'

const REASON = 'made by link-check crawl'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(readFileSync('supabase/migrations/168_search_count_excluded.sql', 'utf8'))

    const { rows } = (await c.query(
      `select id::text as id, session_id, surface, master_id, city, area, mode, gender, created_at from anon_search_events order by created_at, id`,
    )) as { rows: { id: string; session_id: string; surface: string; master_id: number | null; city: string | null; area: string | null; mode: string | null; gender: string | null; created_at: Date }[] }
    const logged: LoggedSearch[] = rows.map((r) => ({
      id: r.id,
      visitor: r.session_id,
      what: [r.surface, r.master_id ?? '', (r.city ?? '').toLowerCase(), (r.area ?? '').toLowerCase(), r.mode ?? '', r.gender ?? ''].join('|'),
      at: r.created_at.toISOString(),
    }))
    const flags = recountAnon(logged)

    const since = Date.now() - 30 * 86_400_000
    const recent = rows.filter((r) => r.created_at.getTime() >= since)
    const tutors = recent.filter((r) => r.surface === 'tutors')
    const counted = (list: typeof rows) => list.filter((r) => !flags.has(r.id))
    const combos = (list: typeof rows) => {
      const m = new Map<string, number>()
      for (const r of list) {
        if (!r.master_id || !(r.city ?? '').trim()) continue
        const k = `${r.master_id}::${(r.city ?? '').trim().toLowerCase()}`
        m.set(k, (m.get(k) ?? 0) + 1)
      }
      return m
    }
    const atLeast = (m: Map<string, number>, n: number) => [...m.values()].filter((v) => v >= n).length
    const by = (reason: string) => [...flags.values()].filter((v) => v === reason).length

    console.log(`anonymous search log, all time: ${rows.length} rows · ${new Set(rows.map((r) => r.session_id)).size} visitors`)
    console.log(`  not counted: ${flags.size} (seen once — crawler or first request: ${by('first_hit')} · repeat inside 30 minutes: ${by('repeat')})`)
    console.log(`  counted: ${rows.length - flags.size}`)
    console.log(`last 30 days, all surfaces: ${recent.length} → ${counted(recent).length}`)
    console.log(`last 30 days, tutor searches: ${tutors.length} → ${counted(tutors).length}`)
    const before = combos(tutors)
    const after = combos(counted(tutors))
    console.log(`  subject × city pairs searched: ${before.size} → ${after.size}`)
    console.log(`  pairs with 8 or more searches (the recruitment-card line): ${atLeast(before, 8)} → ${atLeast(after, 8)}`)
    console.log(`  busiest pair: ${Math.max(0, ...before.values())} → ${Math.max(0, ...after.values())} searches`)

    // Member searches: staff and 30-minute repeats (filtered when read; nothing to flag).
    const mem = (await c.query(
      `select l.id::text as id, l.user_id::text as user_id, l.meta, l.created_at, (p.role = 'admin') as staff
         from user_activity_log l left join profiles p on p.id = l.user_id
        where l.event = 'search_performed' and l.created_at > now() - interval '30 days' and l.meta->>'surface' = 'tutors'`,
    )).rows as { id: string; user_id: string; meta: Record<string, unknown>; created_at: Date; staff: boolean | null }[]
    const memRepeats = repeatIds(mem.map((r) => ({ id: r.id, visitor: r.user_id, what: `${String(r.meta.master_id ?? '')}|${String(r.meta.city ?? '').toLowerCase()}`, at: r.created_at.toISOString() })))
    const memCounted = mem.filter((r) => !r.staff && !memRepeats.has(r.id))
    console.log(`last 30 days, member tutor searches: ${mem.length} → ${memCounted.length} (staff ${mem.filter((r) => r.staff).length} · repeats ${mem.filter((r) => !r.staff && memRepeats.has(r.id)).length})`)

    const unmet = (await c.query(`select coalesce(role, '(guest)') as role, count(*)::int as n from search_unmet where created_at > now() - interval '30 days' group by 1 order by 2 desc`)).rows
    console.log(`unmet searches, last 30 days (already left staff and test out when shown): ${JSON.stringify(unmet)}`)

    // Flag, in batches by reason.
    for (const reason of ['first_hit', 'repeat']) {
      const ids = [...flags.entries()].filter(([, v]) => v === reason).map(([id]) => id)
      for (let i = 0; i < ids.length; i += 2000) {
        await c.query(`update anon_search_events set excluded = $1 where id::text = any($2::text[]) and excluded is null`, [reason, ids.slice(i, i + 2000)])
      }
    }
    const flagged = (await c.query(`select coalesce(excluded, '(counted)') as excluded, count(*)::int as n from anon_search_events group by 1 order by 2 desc`)).rows
    console.log(`anon_search_events after flagging: ${JSON.stringify(flagged)}`)

    const cardsBefore = (await c.query(`select count(*)::int as n from content_suggestions where card = 'recruitment' and status = 'suggested'`)).rows[0].n as number
    const dismissed = await c.query(
      `update content_suggestions set status = 'dismissed', dismiss_reason = $1, updated_at = now() where card = 'recruitment' and status = 'suggested' returning id`,
      [REASON],
    )
    console.log(`recruitment cards open: ${cardsBefore} → 0 (dismissed "${REASON}": ${dismissed.rowCount}; none deleted)`)
    const total = (await c.query(`select count(*)::int as n from content_suggestions`)).rows[0].n
    console.log(`content_suggestions rows in all (unchanged by this): ${total}`)

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
