import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadAdList } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import AdsClient from './AdsClient'

// Advertisement management. owner / manager.
//
// The list carries impressions, clicks and a click-through rate because that
// is what an academy is buying and what they will ask for at renewal. The
// counters come from ad_events through a trigger, and ad_events has no INSERT
// policy for anyone holding the anon key -- so the numbers we report are
// numbers nobody outside the server could have written.

export const dynamic = 'force-dynamic'

export default async function AdminAdsPage() {
  await requireAdminRole(...SCREEN_ACCESS.ads)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const { rows, nextCursor, total } = await loadAdList({})

  return <AdsClient ads={rows} initialCursor={nextCursor} total={total} />
}
