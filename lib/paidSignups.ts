// lib/paidSignups.ts
//
// The paid sign-ups view (owner, 9 Nov 2026) — the I/O half, run by the admin
// summary job (key 'paidsignups'); the page only reads the stored payload.
// Every paid tutor once, with when they paid and who brought them, from the
// SAME accounts and paid rule Team activity counts (lib/staffSignups —
// countableCreditedAccounts + loadAdminDirectAccounts, firstPaidAt). The
// credit rules are not changed here. No name of a member, no phone, no money figure.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { countableCreditedAccounts, loadAdminDirectAccounts } from '@/lib/staffSignups'
import { attributionOf, type PaidSignup, type PaidSignupsPayload } from '@/lib/paidSignupsCore'

export async function loadPaidSignups(): Promise<PaidSignupsPayload> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], names: {} }
  const [staffCredited, direct, refused] = await Promise.all([
    countableCreditedAccounts(),
    loadAdminDirectAccounts(),
    pageAll((from, to) =>
      admin.from('admin_audit_log').select('id, target_id').eq('action', 'staff.signup_credit_refused').order('id').range(from, to),
    ).catch(() => []),
  ])
  const refusedIds = new Set(refused.map((r) => r.target_id as string))
  const rows: PaidSignup[] = []
  const staffIds = new Set<string>()
  const seen = new Set<string>()
  for (const a of [...staffCredited, ...direct]) {
    if (a.role !== 'tutor' || !a.at.paid || seen.has(a.memberId)) continue
    seen.add(a.memberId)
    const by = attributionOf(a.staffId, refusedIds.has(a.memberId))
    if (by === a.staffId) staffIds.add(by)
    rows.push({ at: a.at.paid, by })
  }
  rows.sort((x, y) => x.at.localeCompare(y.at))
  const names: Record<string, string> = {}
  if (staffIds.size) {
    const { data } = await admin.from('profiles').select('id, full_name, former_staff_at').in('id', [...staffIds])
    for (const p of data ?? []) {
      const n = formatName((p.full_name as string | null) ?? '') || 'Staff'
      names[p.id as string] = p.former_staff_at ? `${n} (former staff)` : n
    }
  }
  return { rows, names }
}
