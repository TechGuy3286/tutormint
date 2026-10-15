import { redirect } from 'next/navigation'

import { TEAM_ACTIVITY_PATH, withQuery } from '@/lib/teamActivityCore'

// One staff member's detail moved to Team activity (owner, 15 Oct 2026); the
// filters in the query string are kept.

export const dynamic = 'force-dynamic'

export default async function StaffDetailMoved({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  redirect(withQuery(`${TEAM_ACTIVITY_PATH}/${encodeURIComponent(id)}`, await searchParams))
}
