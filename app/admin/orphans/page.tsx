import { redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'

// Orphaned accounts were folded into the Abandoned signups page as a second
// section (owner, 14 Sep 2026). The standalone screen is gone from the nav; this
// route stays only to redirect any bookmark or old link to its new home.

export const dynamic = 'force-dynamic'

export default async function AdminOrphansPage() {
  // PR106-H2 §1.5 — this route had no role check. Enforce the same role that
  // guards its destination before redirecting, so a restricted role is refused
  // here rather than only at /admin/signups.
  await requireAdminRole(...SCREEN_ACCESS.signups)
  redirect('/admin/signups')
}
