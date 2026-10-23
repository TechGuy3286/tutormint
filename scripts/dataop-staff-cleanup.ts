/**
 * scripts/dataop-staff-cleanup.ts — the staff clean-up (owner, 24 Oct 2026).
 *
 * Keeps staff access for: Khizra Danish, Aqsa Mughal, Mahnoor Amin, Zubia
 * Bashir, Nabeel, Inzamam Ullah — plus the Owner (Alee Sabeer) and Rai Mohsin
 * Raza, whose access is never touched. Aseer Ul Hassan was removed from the
 * keep list by the owner (24 Oct 2026: "Treat as former staff"). A keep name
 * that matches no account, or more than one, changes nothing for that name.
 *
 * Everyone else with staff access or staff ties becomes former staff
 * (lib/formerStaff makeFormerStaff: admin access off, sessions signed out,
 * staff link deactivated, out of City owners and the target list, tuitions
 * moved to each tuition's city owner or the Owner). Aqsa Mughal becomes
 * Supervisor. Every change is in Audit, under the Owner.
 *
 * Without --apply it only prints the plan. Names only — never a phone, CNIC
 * or email.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-staff-cleanup.ts [--apply]
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { loadStaffAccounts, makeFormerStaff } from '@/lib/formerStaff'
import { planStaffCleanup } from '@/lib/formerStaffCore'
import { changeStaffRole } from '@/lib/staff'
import { formatName } from '@/lib/formatName'
import type { AdminRole } from '@/lib/adminAccessCore'

const KEEP = ['Khizra Danish', 'Aqsa Mughal', 'Mahnoor Amin', 'Zubia Bashir', 'Nabeel', 'Inzamam Ullah']
const SUPERVISOR = 'Aqsa Mughal'
const REASON = 'Staff clean-up (owner, 24 Oct 2026)'

async function main() {
  const apply = process.argv.includes('--apply')
  const admin = createAdminClient()
  if (!admin) throw new Error('no service role')
  const accounts = await loadStaffAccounts()
  const plan = planStaffCleanup(accounts, KEEP)

  console.log('Owner-level, unchanged:', plan.untouched.map((a) => `${a.name} (${a.adminRole})`).join(', '))
  console.log('Keep:', plan.keep.map((k) => `${k.account.name} (${k.account.adminRole ?? k.account.role})`).join(', '))
  if (plan.unmatched.length) console.log('NOT MATCHED — nothing changed for:', plan.unmatched.map((u) => `${u.name} (${u.matches} accounts)`).join(', '))
  console.log('Becomes former staff:', plan.remove.map((a) => `${a.name} (${a.adminRole ?? a.role})`).join(', ') || 'nobody')

  const { data: owner } = await admin.from('profiles').select('id, email').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  if (!owner) throw new Error('no Owner account')
  const actor = { id: owner.id as string, adminRole: 'owner' as AdminRole, email: (owner.email as string | null) ?? null }

  const ids = plan.remove.map((a) => a.id)
  if (ids.length) {
    const [{ data: cities }, { data: tuitions }] = await Promise.all([
      admin.from('city_owners').select('city, staff_id').in('staff_id', ids),
      admin.from('tuition_owners').select('job_id, staff_id').in('staff_id', ids),
    ])
    for (const a of plan.remove) {
      const c = (cities ?? []).filter((r) => r.staff_id === a.id).map((r) => r.city)
      const t = (tuitions ?? []).filter((r) => r.staff_id === a.id).length
      console.log(`  ${a.name}: cities ${c.join(', ') || 'none'}; tuitions owned ${t}`)
    }
  }
  const sup = plan.keep.find((k) => k.name === SUPERVISOR)?.account
  console.log(`Supervisor: ${sup ? `${sup.name} (${sup.adminRole} → supervisor)` : 'NOT MATCHED — unchanged'}`)

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  const names = new Map<string, string>()
  const nameOf = async (id: string) => {
    if (!names.has(id)) {
      const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
      names.set(id, formatName((data?.full_name as string | null) ?? '') || 'Staff')
    }
    return names.get(id)!
  }
  for (const a of plan.remove) {
    const r = await makeFormerStaff(actor, a.id, REASON)
    if (!r.ok) {
      console.log(`  ${a.name}: NOT CHANGED — ${r.error}`)
      continue
    }
    console.log(`  ${r.name}: former staff (was ${r.fromRole ?? 'unknown'}); signed out: ${r.sessionsRevoked ? 'yes' : 'no'}; cities released: ${r.citiesReleased.join(', ') || 'none'}; tuitions moved: ${r.moved.length}`)
    const byTo = new Map<string, string[]>()
    for (const m of r.moved) byTo.set(m.toId, [...(byTo.get(m.toId) ?? []), m.ref ?? m.jobId])
    for (const [to, refs] of byTo) console.log(`    → ${await nameOf(to)}: ${refs.sort().join(', ')}`)
  }
  if (sup && sup.adminRole !== 'supervisor') {
    const r = await changeStaffRole({ userId: sup.id, adminRole: 'supervisor', actor })
    console.log(`  ${sup.name}: ${r.ok ? 'now Supervisor' : `NOT CHANGED — ${r.error}`}`)
  }
  console.log('\nApplied.')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
