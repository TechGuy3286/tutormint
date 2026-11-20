import 'server-only'

// lib/staffAllRows.ts — the server half of lib/staffAllRowsCore (PR-12): read
// the 'staff.all_rows' grant list (cached a minute) and answer "does this actor
// see every row?". A failed read grants nothing beyond the role rule.

import { createAdminClient } from '@/lib/supabase/admin'
import { memoize } from '@/lib/memoCache'
import { ALL_ROWS_KEY, parseAllRowsStaff, seesAllRowsFrom } from '@/lib/staffAllRowsCore'

async function loadAllRowsStaffFresh(): Promise<string[]> {
  try {
    const admin = createAdminClient()
    if (!admin) return []
    const { data } = await admin.from('app_settings').select('value').eq('key', ALL_ROWS_KEY).maybeSingle()
    return [...parseAllRowsStaff((data?.value as string | null) ?? null)]
  } catch {
    return []
  }
}

const cached = memoize(loadAllRowsStaffFresh, ['staff-all-rows-v1'], { revalidate: 60 })

export async function loadAllRowsStaff(): Promise<Set<string>> {
  return new Set(await cached())
}

/** Owner / Partner, a role in `roles`, or an account on the grant list. */
export async function seesAllRows(actor: { id: string; adminRole: string | null | undefined }, roles: readonly string[]): Promise<boolean> {
  if (seesAllRowsFrom(actor, roles, new Set())) return true
  return seesAllRowsFrom(actor, roles, await loadAllRowsStaff())
}
