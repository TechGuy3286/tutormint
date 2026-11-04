/**
 * scripts/dataop-removed-to-former.ts — backfill (owner, 4 Nov 2026).
 *
 * Before 4 Nov 2026 "Remove from team" only took the staff role away; it did
 * not make the person former staff, so they were missing from "Former staff"
 * on Team and Team activity and their join link still credited them. This
 * finds every account that was removed that way and is not former staff, and
 * runs the same former-staff flow (lib/formerStaff makeFormerStaff), dated at
 * the removal and with its reason. Inzamam Ullah's reason is "Inactive" (the
 * owner's instruction).
 *
 * "Removed this way" = the newest staff.* Audit row naming the account is
 * staff.remove, the account is not staff now (role <> 'admin') and
 * profiles.former_staff_at is empty.
 *
 * Without --apply it only prints the list. Names, dates and reasons only —
 * never a phone, CNIC or email. Audited under the Owner.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-removed-to-former.ts [--apply]
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { makeFormerStaff } from '@/lib/formerStaff'
import { formatName } from '@/lib/formatName'
import type { AdminRole } from '@/lib/adminAccessCore'

const REASON_OVERRIDE: Record<string, string> = { 'Inzamam Ullah': 'Inactive' }
const STAFF_ACTIONS = ['staff.create', 'staff.grant_existing', 'staff.role_change', 'staff.remove', 'staff.restore', 'staff.former']

async function main() {
  const apply = process.argv.includes('--apply')
  const admin = createAdminClient()
  if (!admin) throw new Error('no service role')

  const { data: rows, error } = await admin
    .from('admin_audit_log')
    .select('target_id, action, detail, created_at')
    .in('action', STAFF_ACTIONS)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) throw new Error('audit unreadable')

  const latest = new Map<string, { action: string; detail: Record<string, unknown>; at: string }>()
  for (const r of rows ?? []) {
    const id = r.target_id as string | null
    if (!id || latest.has(id)) continue
    latest.set(id, { action: r.action as string, detail: (r.detail ?? {}) as Record<string, unknown>, at: r.created_at as string })
  }
  const removedIds = [...latest].filter(([, v]) => v.action === 'staff.remove').map(([id]) => id)
  if (!removedIds.length) {
    console.log('Nobody was removed with the old "Remove from team".')
    return
  }
  const { data: profiles } = await admin.from('profiles').select('id, full_name, role, former_staff_at').in('id', removedIds)
  const todo = (profiles ?? [])
    .filter((p) => p.role !== 'admin' && !p.former_staff_at)
    .map((p) => {
      const name = formatName((p.full_name as string | null) ?? '') || 'Staff member'
      const l = latest.get(p.id as string)!
      const reason = REASON_OVERRIDE[name] ?? ((typeof l.detail.reason === 'string' && l.detail.reason.trim()) || 'Removed from team')
      return { id: p.id as string, name, at: l.at, reason }
    })
  console.log(`Removed with the old flow and not former staff: ${todo.length}`)
  for (const t of todo) console.log(`  ${t.name} — removed ${t.at.slice(0, 10)} — reason "${t.reason}"`)
  if (!todo.find((t) => t.name === 'Inzamam Ullah')) console.log('NOTE: Inzamam Ullah is not in the list.')
  if (!apply || !todo.length) return

  const { data: owner } = await admin.from('profiles').select('id, email').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  if (!owner) throw new Error('no Owner account')
  const actor = { id: owner.id as string, adminRole: 'owner' as AdminRole, email: (owner.email as string | null) ?? null }
  for (const t of todo) {
    const r = await makeFormerStaff(actor, t.id, t.reason, { at: t.at })
    console.log(r.ok ? `  done: ${t.name} (cities released ${r.citiesReleased.length}, tuitions moved ${r.moved.length})` : `  FAILED: ${t.name} — ${r.error}`)
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : 'failed')
    process.exit(1)
  },
)
