import { redirect } from 'next/navigation'

// Orphaned accounts were folded into the Abandoned signups page as a second
// section (owner, 14 Sep 2026). The standalone screen is gone from the nav; this
// route stays only to redirect any bookmark or old link to its new home.

export const dynamic = 'force-dynamic'

export default function AdminOrphansPage() {
  redirect('/admin/signups')
}
