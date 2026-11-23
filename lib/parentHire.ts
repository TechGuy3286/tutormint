import 'server-only'

// lib/parentHire.ts — the I/O of lib/parentHireCore (PR-17 Part D).

import { createAdminClient } from '@/lib/supabase/admin'
import { hireAllowance, type HireAllowance } from '@/lib/parentHireCore'

/** Lifetime hires: this parent's tuitions completed with a hired tutor. */
export async function countParentHires(parentId: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { count, error } = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', parentId)
    .not('hired_at', 'is', null)
  if (error) return null
  return count ?? 0
}

/** The parent's hire allowance. `featured` = the plan carries can_hire
 *  (parent Featured). A failed count fails open (read as 0 used), as the
 *  other quotas do (lib/quota) — a database hiccup never blocks a real hire. */
export async function parentHireAllowance(parentId: string, featured: boolean): Promise<HireAllowance> {
  const used = await countParentHires(parentId)
  return hireAllowance({ featured, used: used ?? 0 })
}
