// lib/paidSignups.ts
//
// The paid sign-ups view (owner, 9 Nov 2026) — the I/O half, run by the admin
// summary job (key 'paidsignups'); the page only reads the stored payload.
// Every paid tutor once, with when they paid and who brought them, from the
// SAME accounts and paid rule Team activity counts (lib/staffSignups —
// countableCreditedAccounts + loadAdminDirectAccounts, firstPaidAt). The
// credit rules are not changed here. No name of a member, no phone, no money figure.

import { runMemo } from '@/lib/runMemo'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { countableCreditedAccounts, loadAdminDirectAccounts } from '@/lib/staffSignups'
import { attributionOf, type PaidSignup, type PaidSignupsPayload } from '@/lib/paidSignupsCore'

/** One paid tutor sign-up with the member it belongs to — for the Overview
 *  "Paid" card's list (never stored in the view's payload). */
export type PaidSignupMember = PaidSignup & { memberId: string }

/** Every paid tutor sign-up, oldest first — the ONE source of the paid sign-ups
 *  view and the Overview "Paid" card (owner, 10 Nov 2026). Once per summary run. */
export function loadPaidSignupMembers(): Promise<{ rows: PaidSignupMember[]; staffIds: string[] }> {
  return runMemo('paid-signup-members', loadMembers)
}

async function loadMembers(): Promise<{ rows: PaidSignupMember[]; staffIds: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], staffIds: [] }
  const [staffCredited, direct, refused] = await Promise.all([
    countableCreditedAccounts(),
    loadAdminDirectAccounts(),
    pageAll((from, to) =>
      admin.from('admin_audit_log').select('id, target_id').eq('action', 'staff.signup_credit_refused').order('id').range(from, to),
    ).catch(() => []),
  ])
  const refusedIds = new Set(refused.map((r) => r.target_id as string))
  const rows: PaidSignupMember[] = []
  const staffIds = new Set<string>()
  const seen = new Set<string>()
  for (const a of [...staffCredited, ...direct]) {
    if (a.role !== 'tutor' || !a.at.paid || seen.has(a.memberId)) continue
    seen.add(a.memberId)
    const by = attributionOf(a.staffId, refusedIds.has(a.memberId))
    if (by === a.staffId) staffIds.add(by)
    rows.push({ at: a.at.paid, by, memberId: a.memberId })
  }
  rows.sort((x, y) => x.at.localeCompare(y.at))
  return { rows, staffIds: [...staffIds] }
}

export async function loadPaidSignups(): Promise<PaidSignupsPayload> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], names: {} }
  const { rows: members, staffIds } = await loadPaidSignupMembers()
  const rows: PaidSignup[] = members.map(({ at, by }) => ({ at, by }))
  const names: Record<string, string> = {}
  if (staffIds.length) {
    const { data } = await admin.from('profiles').select('id, full_name, former_staff_at').in('id', staffIds)
    for (const p of data ?? []) {
      const n = formatName((p.full_name as string | null) ?? '') || 'Staff'
      names[p.id as string] = p.former_staff_at ? `${n} (former staff)` : n
    }
  }
  return { rows, names }
}
