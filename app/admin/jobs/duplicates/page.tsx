import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { recentRepeats } from '@/lib/duplicates'
import DuplicatesClient from './DuplicatesClient'

// Admin → Tuitions → Duplicates (owner, 6 Oct 2026, item 16): every open or
// paused tuition posted this week that repeats an OLDER open/paused tuition
// (same title, or the same city + area + level + subjects + gender + budget),
// grouped by the staff member who posted it, with one-tap "Merge into original"
// (admin + owner) that does item 15's steps. Nothing is deleted.

export const dynamic = 'force-dynamic'

const WEEK_MS = 7 * 86_400_000

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.duplicates)
  const sp = await searchParams
  const days = Math.min(90, Math.max(1, Math.floor(Number(sp.days) || 7)))
  const since = new Date(Date.now() - days * (WEEK_MS / 7))
  const pairs = await recentRepeats(since)
  return (
    <DuplicatesClient
      pairs={pairs}
      days={days}
      canMerge={roleSatisfies(actor.adminRole, SCREEN_ACCESS.duplicatesMerge)}
    />
  )
}
