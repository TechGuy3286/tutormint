/**
 * scripts/dataop-pause-no-contact-tuitions.ts — one-time clean-up (owner,
 * 12 Oct 2026): pause every LIVE tuition that has no valid contact number.
 *
 * Without --apply it is a READ-ONLY dry run: it counts and lists them (TM
 * number, title, city, posted date, posted by) and changes nothing.
 * With --apply it pauses exactly those tuitions — status 'paused', paused_at,
 * pause_source 'no_contact' — in one transaction, and writes one audit entry
 * per tuition (actor "system: missing contact"). Nothing is deleted and no
 * other column is touched. Google is told the same way the nightly pause tells it
 * (one indexing_queue notice per tuition, sent within the daily allowance).
 * Safe to run twice: a paused tuition is not live, so
 * the second run finds nothing to pause.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-pause-no-contact-tuitions.ts
 *   npx tsx --env-file=.env.local scripts/dataop-pause-no-contact-tuitions.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { citySegment } from '../lib/slugs'
import { NO_CONTACT_ACTOR, NO_CONTACT_REASON, NO_CONTACT_SOURCE, tuitionsToPause } from '../lib/tuitionContactCore'

type Row = {
  id: string
  ref_id: string | null
  job_tx_id: string | null
  title: string | null
  city: string | null
  status: string
  public_slug: string | null
  created_at: Date
  is_team: boolean
  poster: string | null
  contact_phone: string | null
  contact_whatsapp: string | null
  parent_phone: string | null
  parent_verified: Date | null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const load = async () =>
    (
      await c.query(
        `select j.id, j.ref_id, j.job_tx_id, j.title, j.city, j.status, j.public_slug, j.created_at,
                coalesce(p.is_team_account, false) as is_team, p.full_name as poster,
                jc.contact_phone, jc.contact_whatsapp,
                p.phone_number as parent_phone, p.phone_verified_at as parent_verified
           from jobs j
           left join profiles p on p.id = j.parent_id
           left join job_contacts jc on jc.job_id = j.id
          order by j.created_at, j.id`,
      )
    ).rows as Row[]
  const facts = (r: Row) => ({
    id: r.id,
    status: r.status,
    isTeam: r.is_team,
    contactPhone: r.contact_phone,
    contactWhatsapp: r.contact_whatsapp,
    parentPhone: r.parent_phone,
    parentPhoneVerifiedAt: r.parent_verified ? r.parent_verified.toISOString() : null,
  })
  const counts = async () =>
    (await c.query(`select status, count(*)::int as n from jobs group by status order by status`)).rows.map((r: { status: string; n: number }) => `${r.status} ${r.n}`).join(' · ')

  const all = await load()
  const byId = new Map(all.map((r) => [r.id, r]))
  const due = tuitionsToPause(all.map(facts)).map((f) => byId.get(f.id)!)
  const open = all.filter((r) => r.status === 'open')
  const parentOpen = open.filter((r) => !r.is_team)
  console.log(`tuitions by status: ${await counts()}`)
  console.log(`open: ${open.length} (staff-posted ${open.length - parentOpen.length}, parent-posted ${parentOpen.length})`)
  console.log(`parent-posted open tuitions with no verified mobile: ${due.filter((r) => !r.is_team).length}`)
  console.log(`live tuitions with no valid contact number: ${due.length}`)
  for (const r of due) {
    console.log(`  ${r.ref_id ?? '-'} | ${(r.title ?? '').slice(0, 70)} | ${r.city ?? '-'} | posted ${r.created_at.toISOString().slice(0, 10)} | by ${r.is_team ? 'TutorMint team' : (r.poster ?? '-')}`)
  }
  if (!apply) {
    console.log('DRY RUN — nothing changed. Re-run with --apply to pause them.')
    await c.end()
    return
  }
  if (due.length === 0) {
    console.log('Nothing to pause.')
    await c.end()
    return
  }

  await c.query('begin')
  try {
    const now = new Date().toISOString()
    let paused = 0
    for (const r of due) {
      const res = await c.query(`update jobs set status = 'paused', paused_at = $2, pause_source = $3 where id = $1 and status = 'open'`, [r.id, now, NO_CONTACT_SOURCE])
      if (res.rowCount !== 1) continue
      paused++
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values (null, $1, 'system', 'job.pause', 'job', $2, $3::jsonb)`,
        [NO_CONTACT_ACTOR, r.id, JSON.stringify({ reason: NO_CONTACT_REASON, refId: r.ref_id, jobTxId: r.job_tx_id, title: r.title, source: NO_CONTACT_SOURCE, dataop: 'pause-no-contact-tuitions' })],
      )
    }
    // The same notice the nightly pause queues, so Google drops the listing.
    for (const r of due) {
      if (!r.public_slug) continue
      await c.query(`insert into indexing_queue (url, kind) values ($1, 'URL_UPDATED')`, [`https://www.tutormint.org/tuitions/${citySegment(r.city)}/${r.public_slug}`])
    }
    if (paused !== due.length) throw new Error(`expected to pause ${due.length}, paused ${paused} — rolling back`)
    await c.query('commit')
    console.log(`PAUSED ${paused} tuitions (reason: ${NO_CONTACT_REASON}); ${paused} audit entries.`)
    console.log(`tuitions by status now: ${await counts()}`)
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
