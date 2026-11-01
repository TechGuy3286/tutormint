// scripts/dataop-staff-tenure.ts (owner, 2 Nov 2026, Part G). Backfills
// staff_tenure for every current and former staff account from its first
// staff.create / staff.grant_existing audit row. Never overwrites a row that
// exists. Without --apply it only prints. Prints names, roles, dates, source.
//   npx tsx --env-file=.env.local scripts/dataop-staff-tenure.ts [--apply]
import { createClient } from '@supabase/supabase-js'
import { joinFromAudit, pkDateTime, type TenureAudit } from '../lib/staffTenureCore'

async function main() {
  const apply = process.argv.includes('--apply')
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: staff } = await db.from('profiles').select('id, full_name, admin_role, former_staff_at, former_staff_role').or('role.eq.admin,former_staff_at.not.is.null')
  const ids = (staff ?? []).map((s) => s.id as string)
  const [{ data: logs }, { data: have }] = await Promise.all([
    db.from('admin_audit_log').select('action, actor_id, target_id, created_at').in('target_id', ids).in('action', ['staff.create', 'staff.grant_existing']).order('created_at'),
    db.from('staff_tenure').select('staff_id').in('staff_id', ids),
  ])
  const { data: actors } = await db.from('profiles').select('id, full_name').in('id', [...new Set((logs ?? []).map((l) => l.actor_id as string))])
  const nm = new Map((actors ?? []).map((a) => [a.id as string, a.full_name as string]))
  const existing = new Set((have ?? []).map((h) => h.staff_id as string))
  let written = 0
  for (const s of staff ?? []) {
    const rows: (TenureAudit & { actorId: string })[] = (logs ?? [])
      .filter((l) => l.target_id === s.id)
      .map((l) => ({ action: l.action as string, createdAt: l.created_at as string, actorName: nm.get(l.actor_id as string) ?? null, actorId: l.actor_id as string }))
    const join = joinFromAudit(rows)
    const role = (s.admin_role as string | null) ?? `former ${s.former_staff_role ?? ''}`.trim()
    if (!join) {
      console.log(`${s.full_name} | ${role} | Joined: not recorded (no audit row) — Owner can "Set date"`)
      continue
    }
    const by = rows.find((r) => r.createdAt === join.joinedAt)?.actorId ?? null
    console.log(`${s.full_name} | ${role} | ${pkDateTime(join.joinedAt)} PKT | added by ${join.joinedByName ?? '?'} | source ${join.source}${existing.has(s.id as string) ? ' | already stored' : ''}`)
    if (!apply || existing.has(s.id as string)) continue
    const { error } = await db.from('staff_tenure').insert({ staff_id: s.id, joined_at: join.joinedAt, joined_by: by, joined_by_name: join.joinedByName, source: join.source })
    if (error) console.error('  not written:', error.message)
    else written++
  }
  console.log(apply ? `${written} row(s) written.` : 'dry run — nothing written')
}
main()
