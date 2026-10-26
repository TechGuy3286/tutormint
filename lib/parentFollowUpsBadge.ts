import 'server-only'

import { unstable_cache } from 'next/cache'
import { parentFollowUpsOverdueCount } from '@/lib/parentFollowUps'

// The Parents part of the Follow-ups badge (owner, 26 Oct 2026), held for five
// minutes: the admin layout draws it on every admin page, and the parents' list
// reads every parent account. 0 on any failure.

export const cachedParentOverdueCount = unstable_cache(async () => parentFollowUpsOverdueCount(), ['parent-follow-ups-overdue'], {
  revalidate: 300,
})
