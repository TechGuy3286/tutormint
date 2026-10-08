import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadPausedTuitions, type PausedFilters } from '@/lib/pausedTuitions'
import { pauseBacklogStatus } from '@/lib/tuitionPause'
import { formatDate } from '@/lib/datetime'
import PausedClient from './PausedClient'

// Marketplace → Paused tuitions (owner, 8 Oct 2026). Every role that can post
// tuitions. Auto-paused tuitions newest first, filters, Resume one or many, and
// the backlog's progress while the 7-day rule works through the old tuitions.

export const dynamic = 'force-dynamic'

type SP = { city?: string; age?: string; apps?: string }

export default async function PausedTuitionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdminRole(...SCREEN_ACCESS.pausedTuitions)
  const sp = await searchParams
  const filters: PausedFilters = {
    city: sp.city ?? '',
    age: sp.age === 'week' || sp.age === 'older' ? sp.age : '',
    apps: sp.apps === 'with' || sp.apps === 'without' ? sp.apps : '',
  }
  const [{ rows, cities }, backlog] = await Promise.all([loadPausedTuitions(filters), pauseBacklogStatus()])
  const next = new Date(backlog.nextBatch)
  const backlogLine =
    backlog.left > 0
      ? `Backlog: ${backlog.left} left · next batch ${formatDate(next.toISOString())} 03:00 UTC (08:00 Pakistan)`
      : 'Backlog cleared — tuitions now pause on their own 7th day.'
  return <PausedClient rows={rows} cities={cities} filters={filters} backlogLine={backlogLine} />
}
