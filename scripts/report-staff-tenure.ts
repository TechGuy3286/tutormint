// scripts/report-staff-tenure.ts — READ ONLY (owner, 2 Nov 2026, Part G).
// For every staff and former-staff account: the first staff.create /
// staff.grant_existing audit row (who, when), the latest role change, and
// staff.former / staff.remove. Prints names, roles and dates only.
//   npx tsx --env-file=.env.local scripts/report-staff-tenure.ts
import { createClient } from '@supabase/supabase-js'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: staff } = await db.from('profiles').select('id, full_name, role, admin_role, former_staff_at, former_staff_role, created_at').or('role.eq.admin,former_staff_at.not.is.null')
  const ids = (staff ?? []).map((s) => s.id as string)
  const { data: rows } = await db
    .from('admin_audit_log')
    .select('action, actor_id, actor_email, target_id, detail, created_at')
    .in('target_id', ids)
    .like('action', 'staff.%')
    .order('created_at')
  const { data: actors } = await db.from('profiles').select('id, full_name').in('id', [...new Set((rows ?? []).map((r) => r.actor_id as string).filter(Boolean))])
  const name = new Map((actors ?? []).map((a) => [a.id as string, a.full_name as string]))
  const counts: Record<string, number> = {}
  for (const r of rows ?? []) counts[r.action as string] = (counts[r.action as string] ?? 0) + 1
  console.log('staff audit actions:', JSON.stringify(counts))
  for (const s of staff ?? []) {
    const mine = (rows ?? []).filter((r) => r.target_id === s.id)
    const join = mine.find((r) => r.action === 'staff.create' || r.action === 'staff.grant_existing')
    const roleRows = mine.filter((r) => r.action === 'staff.role_change')
    const last = roleRows[roleRows.length - 1]
    console.log(
      [
        s.full_name,
        s.admin_role ?? `former (${s.former_staff_role ?? '?'})`,
        'account created ' + String(s.created_at).slice(0, 16),
        join ? `${join.action} ${String(join.created_at).slice(0, 16)} by ${name.get(join.actor_id as string) ?? '?'}` : 'no join row',
        last ? `role change ${String(last.created_at).slice(0, 16)} ${JSON.stringify(last.detail)}` : 'no role change',
        s.former_staff_at ? `left ${String(s.former_staff_at).slice(0, 16)}` : '',
      ].join(' | '),
    )
  }
}
main()
