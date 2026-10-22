import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { legacyApplicationsHref } from '@/lib/applicationStageCore'

// Applicants to forward moved into Applications (owner, 22 Oct 2026: its own
// page, Tuitions → Applications). The old address — and its ?tab=forwarded /
// ?tab=outcome — lands on the "Forward to parents" view there, filters kept.

export const dynamic = 'force-dynamic'

export default async function ApplicantsToForwardMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminRole(...SCREEN_ACCESS.applicantForwards)
  const sp = await searchParams
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  // The bare old address opened the "to forward" board.
  permanentRedirect(legacyApplicationsHref({ ...sp, tab: tab ?? 'to_forward' }))
}
