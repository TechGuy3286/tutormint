import { redirect } from 'next/navigation'

import { followUpsHref } from '@/lib/followUpsPageCore'

// Abandoned signups is now the "Parents & email not confirmed" tab of People →
// Follow-ups (owner, 15 Oct 2026); its orphaned-accounts section is the
// "Orphaned accounts" tab. The old address redirects, query kept.

export const dynamic = 'force-dynamic'

export default async function AbandonedSignupsMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(followUpsHref('parents', await searchParams))
}
