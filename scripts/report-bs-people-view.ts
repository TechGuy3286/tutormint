/**
 * scripts/report-bs-people-view.ts — READ-ONLY (owner, 15 Nov 2026).
 *
 * Why the helper's staff account did not see the People → Tutors pipeline:
 * prints that account's role facts and where its actions came from (no name,
 * email or phone). Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-bs-people-view.ts <email>
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!email) throw new Error('Pass the staff email as the first argument.')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: p } = await admin
    .from('profiles')
    .select('id, role, admin_role, is_suspended, is_banned, staff_paused_at, former_staff_at')
    .ilike('email', email)
  console.log(`profiles matching: ${p?.length ?? 0}`)
  for (const r of p ?? []) {
    console.log(`  id ${String(r.id).slice(0, 8)} role ${r.role}/${r.admin_role ?? '-'} suspended ${!!r.is_suspended} banned ${!!r.is_banned} paused ${!!r.staff_paused_at} former ${!!r.former_staff_at}`)
    const { data: roles } = await admin
      .from('admin_audit_log')
      .select('created_at, detail')
      .eq('target_id', r.id as string)
      .eq('action', 'staff.role_change')
      .order('created_at', { ascending: false })
      .limit(6)
    for (const a of roles ?? []) {
      const d = (a.detail ?? {}) as { from?: string; to?: string }
      console.log(`    ${a.created_at} role ${d.from} -> ${d.to}`)
    }
    const { data: acts } = await admin
      .from('admin_audit_log')
      .select('action, created_at, detail')
      .eq('actor_id', r.id as string)
      .gte('created_at', '2026-11-15T00:00:00Z')
      .order('created_at', { ascending: true })
      .limit(500)
    const by = new Map<string, number>()
    for (const a of acts ?? []) {
      const d = (a.detail ?? {}) as { from?: string; messageType?: string; item?: string }
      const k = `${a.action}${d.from ? ` from=${d.from}` : ''}${d.item ? ` item=${d.item}` : ''}`
      by.set(k, (by.get(k) ?? 0) + 1)
    }
    console.log(`  actions today: ${acts?.length ?? 0}; first ${acts?.[0]?.created_at ?? '-'} last ${acts?.[acts.length - 1]?.created_at ?? '-'}`)
    for (const [k, v] of by) console.log(`    ${k} x${v}`)
    const { count: fu } = await admin.from('member_follow_ups').select('id', { count: 'exact', head: true }).eq('staff_id', r.id as string).gte('created_at', '2026-11-15T00:00:00Z')
    console.log(`  member_follow_ups today: ${fu ?? 0}`)
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
