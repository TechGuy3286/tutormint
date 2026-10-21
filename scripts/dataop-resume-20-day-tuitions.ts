/**
 * scripts/dataop-resume-20-day-tuitions.ts (owner, 21 Oct 2026)
 *
 * The live period moved from 15 to 20 days. Every tuition the OLD rule paused
 * by age (pause_source 'auto' or 'backlog') that is now under 20 days old goes
 * back live — status 'open', paused_at / pause_source cleared — KEEPING its own
 * clock (resumed_at and created_at unchanged), so the nightly sweep pauses it on
 * its own day 20. Rules: lib/autoPauseResumeCore.ts (resumeVerdict). One
 * URL_UPDATED notice per resumed tuition goes into indexing_queue (the normal
 * queue, drained within 200 a Google day). One admin_audit_log row per tuition
 * (job.resume, actor "system: 20-day rule"). No poster is notified. Nothing is
 * deleted. Without --apply nothing is written; a second run resumes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-resume-20-day-tuitions.ts [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { resumeVerdict, type ResumeCandidate, type ResumeVerdict } from '../lib/autoPauseResumeCore'
import { citySegment } from '../lib/slugs'
import { PRIORITY_CHANGE } from '../lib/googleIndexingCore'

const OWNER_EMAIL = 'techguy3286@gmail.com'
const SITE = 'https://www.tutormint.org'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const rows = (
    await c.query(`
      select j.id, j.ref_id, j.status, j.pause_source, j.self_paused_at, j.merged_into, j.created_at, j.resumed_at,
             j.public_slug, j.city, j.title,
             coalesce(p.is_team_account, false) as is_team, p.phone_number, p.phone_verified_at,
             coalesce(p.is_suspended, false) as suspended, coalesce(p.is_banned, false) as banned,
             p.paused_by_user_at, jc.contact_phone, jc.contact_whatsapp
        from jobs j
        left join profiles p on p.id = j.parent_id
        left join job_contacts jc on jc.job_id = j.id
       where j.status = 'paused' and j.pause_source in ('auto', 'backlog')`)
  ).rows as Record<string, unknown>[]

  const now = Date.now()
  const counts: Record<ResumeVerdict, number> = { resume: 0, not_age_pause: 0, too_old: 0, no_contact: 0, poster_unavailable: 0 }
  const toResume: Record<string, unknown>[] = []
  for (const r of rows) {
    const cand: ResumeCandidate = {
      id: r.id as string,
      status: r.status as string,
      pauseSource: (r.pause_source as string | null) ?? null,
      selfPausedAt: r.self_paused_at ? String(r.self_paused_at) : null,
      mergedInto: (r.merged_into as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      resumedAt: r.resumed_at ? new Date(r.resumed_at as string).toISOString() : null,
      posterSuspended: !!r.suspended,
      posterBanned: !!r.banned,
      posterPausedByUser: !!r.paused_by_user_at,
      isTeam: !!r.is_team,
      contactPhone: (r.contact_phone as string | null) ?? null,
      contactWhatsapp: (r.contact_whatsapp as string | null) ?? null,
      parentPhone: (r.phone_number as string | null) ?? null,
      parentPhoneVerifiedAt: r.phone_verified_at ? String(r.phone_verified_at) : null,
    }
    const v = resumeVerdict(cand, now)
    counts[v]++
    if (v === 'resume') toResume.push(r)
  }
  console.log(`age-paused tuitions: ${rows.length}`)
  console.log(`  resume (under 20 days): ${counts.resume}`)
  console.log(`  already 20+ days old:   ${counts.too_old}`)
  console.log(`  no contact number:      ${counts.no_contact}`)
  console.log(`  poster unavailable:     ${counts.poster_unavailable}`)
  console.log(`  other:                  ${counts.not_age_pause}`)
  for (const r of toResume) console.log(`   TM-${r.ref_id ?? '?'}`)
  if (!apply || toResume.length === 0) {
    console.log(apply ? 'nothing to resume' : 'dry run — nothing written')
    await c.end()
    return
  }

  const owner = (await c.query(`select id from profiles where email = $1`, [OWNER_EMAIL])).rows[0]?.id as string | undefined
  await c.query('begin')
  try {
    let resumed = 0
    let queued = 0
    for (const r of toResume) {
      const upd = await c.query(
        `update jobs set status = 'open', paused_at = null, pause_source = null
          where id = $1 and status = 'paused' and pause_source in ('auto', 'backlog') returning id`,
        [r.id],
      )
      if (upd.rowCount !== 1) continue
      resumed++
      if (r.public_slug) {
        await c.query(`insert into indexing_queue (url, kind, priority) values ($1, 'URL_UPDATED', $2)`, [
          `${SITE}/tuitions/${citySegment(r.city as string | null)}/${r.public_slug}`,
          PRIORITY_CHANGE,
        ])
        queued++
      }
      await c.query(
        `insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
         values ($1, 'owner', $2, 'job.resume', 'job', $3, $4::jsonb)`,
        [owner ?? null, 'system: 20-day rule', r.id, JSON.stringify({ refId: r.ref_id ?? null, from: 'dataop-resume-20-day-tuitions', keptClock: true })],
      )
    }
    await c.query('commit')
    console.log(`resumed ${resumed}; Google notices queued ${queued}`)
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
