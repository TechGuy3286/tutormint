import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicAdUrl } from '@/lib/ads'
import AdsClient, { type AdRow } from './AdsClient'

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

  const { data: ads } = await admin
    .from('advertisements')
    .select(
      'id, title, client_name, description, image_path, target_url, audience, starts_at, ends_at, weight, status, impressions, clicks, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  const now = Date.now()

  const rows: AdRow[] = (ads ?? []).map((a) => {
    const starts = new Date(a.starts_at as string).getTime()
    const ends = a.ends_at ? new Date(a.ends_at as string).getTime() : null
    return {
      id: a.id as string,
      title: a.title as string,
      clientName: (a.client_name as string) || null,
      description: (a.description as string) || null,
      imageUrl: a.image_path ? publicAdUrl(a.image_path as string) : null,
      targetUrl: (a.target_url as string) ?? null,
      audience: a.audience as AdRow['audience'],
      startsAt: a.starts_at as string,
      endsAt: (a.ends_at as string) ?? null,
      weight: a.weight as number,
      status: a.status as AdRow['status'],
      impressions: Number(a.impressions ?? 0),
      clicks: Number(a.clicks ?? 0),
      // "Live" is the state that actually matters and it is not a column:
      // an ad is only in the rotation if it is active AND inside its window.
      live: a.status === 'active' && starts <= now && (ends === null || ends > now),
      expired: ends !== null && ends <= now,
    }
  })

  return <AdsClient ads={rows} />
}
