/**
 * scripts/report-approval-queue.ts — READ-ONLY.
 * For every tutor the approval queue lists, compare the queue's "waiting" with
 * the review card's statuses (lib/tutorDocuments loadDocumentStatuses rules).
 *   npx tsx --env-file=.env.local scripts/report-approval-queue.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { deriveCnicStatus } from '../lib/cnicStatus'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`
    select p.id, p.full_name, p.verification_state, p.cnic_verified_at::text as cnic_verified_at, p.cnic_number is not null and btrim(p.cnic_number)<>'' as has_num,
           p.cnic_image_path is not null and btrim(p.cnic_image_path)<>'' as has_img, p.cnic_number, p.cnic_image_path,
           p.profile_pic_status, p.selfie_status, p.avatar_url is not null as has_avatar, tp.video_status,
           (select count(*) from user_documents d where d.user_id=p.id and d.kind='selfie' and d.status='active') as selfie_docs,
           (select string_agg(coalesce(d.label,'?')||':'||d.status, ',') from user_documents d where d.user_id=p.id and d.kind='cnic') as cnic_docs
    from profiles p left join tutor_profiles tp on tp.id=p.id
    where p.role='tutor' and not coalesce(p.is_seed,false) and not coalesce(p.is_banned,false) and not coalesce(p.is_suspended,false) and not coalesce(p.is_team_account,false)
      and (p.verification_state='submitted' or p.profile_pic_status='pending' or p.selfie_status='pending' or tp.video_status='uploaded')
    order by p.full_name`)
  for (const r of rows) {
    const q: string[] = []
    if (r.verification_state === 'submitted') q.push('CNIC')
    if (r.profile_pic_status === 'pending') q.push('Photo')
    if (r.selfie_status === 'pending') q.push('Selfie')
    if (r.video_status === 'uploaded') q.push('Video')
    const card = deriveCnicStatus(r)
    console.log(JSON.stringify({ name: r.full_name, queue: q, cardCnic: card, vs: r.verification_state, cnicVerifiedAt: r.cnic_verified_at, hasNum: r.has_num, hasImg: r.has_img, photo: r.profile_pic_status, hasAvatar: r.has_avatar, selfie: r.selfie_status, selfieDocs: r.selfie_docs, video: r.video_status, cnicDocs: r.cnic_docs }))
  }
  console.log('total', rows.length)
  await c.end()
}
main()
