import { redirect } from 'next/navigation'

import { TEAM_ACTIVITY_PATH, withQuery } from '@/lib/teamActivityCore'

// Moved to Team activity (owner, 15 Oct 2026); the query string is kept.

export const dynamic = 'force-dynamic'

export default async function SignupListMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(withQuery(`${TEAM_ACTIVITY_PATH}/accounts`, await searchParams))
}
