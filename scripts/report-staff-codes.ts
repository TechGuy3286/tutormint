// scripts/report-staff-codes.ts — READ ONLY. Staff codes and credit counts by
// source (owner, 23 Oct 2026). Prints codes, roles and numbers only — never a
// name, mobile or email.
//   npx tsx --env-file=.env.local scripts/report-staff-codes.ts
import { createClient } from '@supabase/supabase-js'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const [{ data: links }, { data: staff }, { data: credits }, { data: visits }] = await Promise.all([
    db.from('staff_join_links').select('staff_id, slug, code'),
    db.from('profiles').select('id, admin_role, is_suspended').eq('role', 'admin'),
    db.from('staff_signup_credits').select('staff_id, source, member_role'),
    db.from('staff_referral_visits').select('source'),
  ])
  const role = new Map((staff ?? []).map((s) => [s.id as string, s]))
  console.log('code | slug | role | active | credits link/code/claim')
  for (const l of links ?? []) {
    const s = role.get(l.staff_id as string)
    const mine = (credits ?? []).filter((c) => c.staff_id === l.staff_id)
    const by = (x: string) => mine.filter((c) => c.source === x).length
    const active = !!s && ['tuitions_staff', 'operations', 'admin'].includes(s.admin_role as string) && !s.is_suspended
    console.log(`${l.code} | ${l.slug} | ${s?.admin_role ?? 'not staff now'} | ${active ? 'yes' : 'no'} | ${by('link')}/${by('code')}/${by('claim')}`)
  }
  const vs = (visits ?? []).reduce<Record<string, number>>((a, v) => ((a[v.source as string] = (a[v.source as string] ?? 0) + 1), a), {})
  console.log('visits by source:', JSON.stringify(vs), '· credits total:', (credits ?? []).length)
}
main()
