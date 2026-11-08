import { permanentRedirect } from 'next/navigation'

import { legacyApplicationsHref } from '@/lib/applicationStageCore'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { followUpsToPeople } from '@/lib/tutorPipelineCore'

// Follow-ups is part of People (owner, 8 Nov 2026). Every old Follow-ups
// address — a chip, a "Closest to paying" stage, the Parents or Orphaned tab —
// lands on the matching People view (lib/tutorPipelineCore followUpsToPeople).
// The old Applications tab still goes to Tuitions → Applications.

export const dynamic = 'force-dynamic'

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  if (sp.tab === 'applications') permanentRedirect(legacyApplicationsHref(sp))
  await requireAdminRole(...SCREEN_ACCESS.people)
  permanentRedirect(followUpsToPeople(sp))
}
