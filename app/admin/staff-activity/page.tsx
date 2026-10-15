import { redirect } from 'next/navigation'

import { staffActivityRedirect } from '@/lib/teamActivityCore'

// Staff activity merged into Tuitions → Team activity (owner, 15 Oct 2026). The
// old address goes to the "Verifications & messages" tab; a role that may not
// open that tab lands on the page's default tab instead.

export const dynamic = 'force-dynamic'

export default function StaffActivityMoved() {
  redirect(staffActivityRedirect())
}
