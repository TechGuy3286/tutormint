/**
 * scripts/report-doc-summary.ts — READ-ONLY.
 * Counts of the combined "Documents" status on the Admin → Overview → Tutors
 * list (every tutor-role account, test-named accounts left out — the list's own
 * rule), with the SAME shared rules the cards use (lib/tutorDocSummaryCore).
 * Prints counts only — no names, numbers or emails.
 *   npx tsx --env-file=.env.local scripts/report-doc-summary.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { tutorCardStatuses } from '../lib/tutorDocQueueCore'
import { docSummary, tutorDocFactsFromRow, type DocSummaryKind } from '../lib/tutorDocSummaryCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows: docs } = await c.query(
    `select user_id, kind, status from user_documents where kind in ('cnic','selfie') and status in ('active','review')`,
  )
  const { rows } = await c.query(`
    select p.id, p.verification_state, p.verification_rejection_reason, p.cnic_verified_at::text as cnic_verified_at,
           p.cnic_number, p.cnic_image_path, p.avatar_url, p.profile_pic_status, p.profile_pic_reason,
           p.profile_pic_rereview_at::text as profile_pic_rereview_at, p.selfie_status, p.selfie_reason, tp.video_status
    from profiles p left join tutor_profiles tp on tp.id = p.id
    where p.role = 'tutor' and p.is_test_name = false`)
  const counts: Record<DocSummaryKind, number> = { approved: 0, waiting: 0, rejected: 0, partial: 0, none: 0 }
  for (const p of rows) {
    const mine = docs.filter((d: { user_id: string }) => d.user_id === p.id)
    const s = tutorCardStatuses(
      tutorDocFactsFromRow(p, {
        hasSelfieFile: mine.some((d: { kind: string; status: string }) => d.kind === 'selfie' && d.status === 'active'),
        hasCnicReview: mine.some((d: { kind: string; status: string }) => d.kind === 'cnic' && d.status === 'review'),
        hasSelfieReview: mine.some((d: { kind: string; status: string }) => d.kind === 'selfie' && d.status === 'review'),
      }),
    )
    counts[docSummary(s, p.video_status).kind]++
  }
  console.log(`Tutors on the list: ${rows.length}`)
  console.log(counts)
  await c.end()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
