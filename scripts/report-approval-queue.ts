/**
 * scripts/report-approval-queue.ts — READ-ONLY.
 * The approval queue, computed with the SAME shared rules the app uses
 * (lib/tutorDocQueueCore tutorWaiting for tutors, lib/parentDocsCore
 * parentWaiting for parents), plus which queued members show "Front side
 * missing" / "Back side missing" on their review card (cnicSideNote, from the
 * ACTIVE CNIC uploads — exactly what the card shows).
 *   npx tsx --env-file=.env.local scripts/report-approval-queue.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { tutorWaiting, cnicSideNote } from '../lib/tutorDocQueueCore'
import { parentWaiting } from '../lib/parentDocsCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows: docs } = await c.query(
    `select user_id, kind, label, status from user_documents where kind in ('cnic','selfie') and status in ('active','review')`,
  )
  const has = (uid: string, pred: (d: { kind: string; label: string | null; status: string }) => boolean) =>
    docs.some((d: { user_id: string; kind: string; label: string | null; status: string }) => d.user_id === uid && pred(d))

  const { rows: tutors } = await c.query(`
    select p.id, p.full_name, p.verification_state, p.cnic_verified_at::text as cnic_verified_at, p.cnic_number, p.cnic_image_path,
           p.avatar_url, p.profile_pic_status, p.profile_pic_rereview_at::text as profile_pic_rereview_at, p.selfie_status, tp.video_status
    from profiles p left join tutor_profiles tp on tp.id = p.id
    where p.role = 'tutor' and not coalesce(p.is_seed,false) and not coalesce(p.is_banned,false)
      and not coalesce(p.is_suspended,false) and not coalesce(p.is_team_account,false)`)
  let tutorCount = 0
  let frontMissing = 0
  let backMissing = 0
  for (const r of tutors) {
    const waiting = tutorWaiting({
      ...r,
      hasSelfieFile: has(r.id, (d) => d.kind === 'selfie' && d.status === 'active'),
      hasCnicReview: has(r.id, (d) => d.kind === 'cnic' && d.status === 'review'),
      hasSelfieReview: has(r.id, (d) => d.kind === 'selfie' && d.status === 'review'),
    })
    if (waiting.length === 0) continue
    tutorCount++
    const front = has(r.id, (d) => d.kind === 'cnic' && d.status === 'active' && d.label !== 'back')
    const back = has(r.id, (d) => d.kind === 'cnic' && d.status === 'active' && d.label === 'back')
    const note = cnicSideNote(front, back)
    if (note === 'Front side missing') frontMissing++
    if (note === 'Back side missing') backMissing++
    console.log(`tutor  | ${r.full_name ?? '(no name)'} | waiting: ${waiting.join(', ')}${note ? ` | ${note}` : ''}`)
  }

  const { rows: parents } = await c.query(`
    select id, full_name, verification_state, cnic_verified_at::text as cnic_verified_at, address, address_status, address_verified_at::text as address_verified_at
    from profiles where role in ('parent','academy') and not coalesce(is_seed,false) and not coalesce(is_banned,false)
      and not coalesce(is_suspended,false) and not coalesce(is_team_account,false)`)
  let parentCount = 0
  for (const r of parents) {
    const waiting = parentWaiting({
      ...r,
      hasCnicFront: has(r.id, (d) => d.kind === 'cnic' && d.status === 'active' && d.label !== 'back'),
      hasCnicBack: has(r.id, (d) => d.kind === 'cnic' && d.status === 'active' && d.label === 'back'),
      hasCnicReview: has(r.id, (d) => d.kind === 'cnic' && d.status === 'review'),
    })
    if (waiting.length === 0) continue
    parentCount++
    console.log(`parent | ${r.full_name ?? '(no name)'} | waiting: ${waiting.join(', ')}`)
  }
  console.log(`queue: ${tutorCount + parentCount} (tutors ${tutorCount}, parents ${parentCount}) · queued tutors showing "Front side missing": ${frontMissing} · "Back side missing": ${backMissing}`)
  await c.end()
}
main()
