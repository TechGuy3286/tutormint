import { redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { followUpsHref } from '@/lib/followUpsPageCore'

// Orphaned accounts is the "Orphaned accounts" tab of People → Follow-ups
// (owner, 15 Oct 2026). This route stays only to redirect old links.

export const dynamic = 'force-dynamic'

export default async function AdminOrphansPage() {
  // PR106-H2 §1.5 — enforce the role that guards the destination tab before
  // redirecting, so a restricted role is refused here too.
  await requireAdminRole(...SCREEN_ACCESS.signups)
  redirect(followUpsHref('orphans'))
}
