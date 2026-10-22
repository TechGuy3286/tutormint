import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'

// Applicants to forward moved into Follow-ups → Applications (owner, 22 Oct
// 2026). The old address — and its ?tab=forwarded / ?tab=outcome — lands on the
// new tab; a sub-tab opens the "Forward to parents" board on the same tab.

export const dynamic = 'force-dynamic'

const OLD_TABS = ['to_forward', 'forwarded', 'outcome']

export default async function ApplicantsToForwardMoved({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.applicantForwards)
  const sp = await searchParams
  const q = new URLSearchParams({ tab: 'applications' })
  if (sp.tab && OLD_TABS.includes(sp.tab)) {
    q.set('view', 'forward')
    if (sp.tab !== 'to_forward') q.set('fwd', sp.tab)
  }
  permanentRedirect(`/admin/follow-ups?${q.toString()}`)
}
