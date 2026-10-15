import { redirect } from 'next/navigation'

import { followUpsHref } from '@/lib/followUpsPageCore'

// Unpaid signups is now the Tutors tab of People → Follow-ups (owner, 15 Oct
// 2026). The old address redirects there, its filter kept
// (?filter=today → /admin/follow-ups?filter=today).

export const dynamic = 'force-dynamic'

export default async function UnpaidSignupsMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(followUpsHref('tutors', await searchParams))
}
