import 'server-only'

// lib/memberNames.ts — the server half of lib/memberNamesCore (owner, 5 Nov 2026).
//   activeStaffNames()   every name an active staff account goes by, so a member's
//                        Display name cannot copy one (held 5 minutes)
//   displayNameRefusal() the full Display name check for one member

import { createAdminClient } from '@/lib/supabase/admin'
import { memoize } from '@/lib/memoCache'
import { displayNameProblem } from '@/lib/memberNamesCore'

export const activeStaffNames = memoize(
  async (): Promise<string[]> => {
    const admin = createAdminClient()
    if (!admin) return []
    const { data } = await admin
      .from('profiles')
      .select('full_name, cnic_name, display_name')
      .eq('role', 'admin')
      .is('former_staff_at', null)
    const out = new Set<string>()
    for (const r of (data ?? []) as Record<string, string | null>[]) {
      for (const v of [r.full_name, r.cnic_name, r.display_name]) if (v && v.trim()) out.add(v.trim())
    }
    return [...out]
  },
  ['active-staff-names'],
  { revalidate: 300 },
)

/** Why this member may not use this Display name, or null. */
export async function displayNameRefusal(memberId: string, value: string | null | undefined): Promise<string | null> {
  const admin = createAdminClient()
  let own: string[] = []
  if (admin) {
    const { data } = await admin.from('profiles').select('full_name, cnic_name, role').eq('id', memberId).maybeSingle()
    // A staff member may use their own name.
    if (data?.role === 'admin') own = [data.full_name, data.cnic_name].filter((x): x is string => !!x)
  }
  return displayNameProblem(value, { staffNames: await activeStaffNames(), ownNames: own })
}
