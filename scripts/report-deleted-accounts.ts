/**
 * scripts/report-deleted-accounts.ts — READ-ONLY.
 *
 * Owner, 5 Nov 2026: how erased / deleted accounts look in the data, and how
 * many still have documents waiting. Counts and ids only — no names, phones,
 * emails or CNIC numbers. Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-deleted-accounts.ts
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: er } = await admin.from('account_erasures').select('member_id, role, status')
  const byStatus = new Map<string, number>()
  for (const e of er ?? []) byStatus.set(e.status as string, (byStatus.get(e.status as string) ?? 0) + 1)
  console.log('account_erasures by status:', Object.fromEntries(byStatus))
  const done = (er ?? []).filter((e) => e.status === 'done').map((e) => e.member_id as string)

  const { data: named } = await admin.from('profiles').select('id, role, is_suspended, is_banned, verification_state, profile_pic_status, selfie_status, avatar_url, cnic_image_path').ilike('full_name', 'deleted user')
  console.log('profiles named "Deleted user":', named?.length ?? 0)
  const namedIds = new Set((named ?? []).map((p) => p.id as string))
  console.log('  of which have a done erasure:', done.filter((id) => namedIds.has(id)).length, '/ done erasures', done.length)
  for (const p of named ?? []) {
    console.log(
      `  ${String(p.id).slice(0, 8)} role=${p.role} susp=${p.is_suspended} ban=${p.is_banned} vstate=${p.verification_state} pic=${p.profile_pic_status} selfie=${p.selfie_status} avatar=${p.avatar_url ? 'yes' : 'no'} cnicPath=${p.cnic_image_path ? 'yes' : 'no'} erased=${done.includes(p.id as string)}`,
    )
  }
  const ids = [...namedIds]
  if (ids.length) {
    const { data: docs } = await admin.from('user_documents').select('user_id, kind, status').in('user_id', ids)
    const m = new Map<string, number>()
    for (const d of docs ?? []) m.set(`${d.kind}/${d.status}`, (m.get(`${d.kind}/${d.status}`) ?? 0) + 1)
    console.log('their user_documents:', Object.fromEntries(m))
    const { data: tp } = await admin.from('tutor_profiles').select('id, verification_status, verified_fee_paid_at').in('id', ids)
    console.log('their tutor_profiles:', (tp ?? []).map((t) => `${String(t.id).slice(0, 8)} vs=${t.verification_status} fee=${t.verified_fee_paid_at ? 'yes' : 'no'}`).join(', '))
  }
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : 'failed'); process.exit(1) })
