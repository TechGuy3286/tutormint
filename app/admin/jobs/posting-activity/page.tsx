import { redirect } from 'next/navigation'

import { postingActivityRedirect } from '@/lib/teamActivityCore'

// Tuition posting activity merged into Tuitions → Team activity (owner, 15 Oct
// 2026). The old address stays as a redirect to the matching tab:
// ?tab=signups → Paid sign-ups (period kept), otherwise → Tuitions posted.

export const dynamic = 'force-dynamic'

export default async function PostingActivityMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(postingActivityRedirect(await searchParams))
}
