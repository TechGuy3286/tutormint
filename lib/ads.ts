// lib/ads.ts
//
// Ad selection, impression recording, and the house creatives.
//
// Two rules from the revenue spec that this module exists to hold:
//
//   * Ads are BANNERS. They never appear as a tutor card and never enter
//     search ranking. Ranking is sold through plans, and a Featured tutor must
//     never find an advertiser sitting above them. Nothing here returns
//     anything a results list could mistake for a result.
//
//   * Labels are honest. A paid ad says "Sponsored". A house ad -- our own
//     package upsell -- says "TutorMint", because calling our own marketing
//     sponsored would be untrue. The two labels come from the ad's own kind,
//     not from a prop a caller could get wrong.
//
// Selection is weighted random over the active ads for the slot's audience.
// Expired ads drop out through the query, not through a filter someone has to
// remember, and an empty pool falls back to a house creative rather than a
// hole in the page.

import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/admin'

export type AdAudience = 'parents' | 'tutors'

/** The three placements the spec allows. There are no others. */
export type AdSlotName = 'browse-inline' | 'parent-sidebar' | 'tutor-dashboard'

export type PaidAd = {
  kind: 'paid'
  id: string
  title: string
  clientName: string | null
  description: string | null
  imageUrl: string | null
  href: string
}

export type HouseAd = {
  kind: 'house'
  id: string
  title: string
  body: string
  cta: string
  href: string
}

export type Ad = PaidAd | HouseAd

const HOUSE_ADS: Record<AdAudience, HouseAd[]> = {
  parents: [
    {
      kind: 'house',
      id: 'house-parent-featured',
      title: 'See tutor contact details instantly',
      body: 'Featured parents view phone and WhatsApp, message any tutor, and complete hires.',
      cta: 'See parent packages',
      href: '/parent/packages?plan=parent_featured',
    },
    {
      kind: 'house',
      id: 'house-parent-verify',
      title: 'Verified parents post jobs free',
      body: 'Approve your CNIC and address once, then post up to five tuitions a month at no cost.',
      cta: 'Verify my account',
      href: '/parent/verify',
    },
  ],
  tutors: [
    {
      kind: 'house',
      id: 'house-tutor-featured',
      title: 'Reach the top of every search',
      body: 'Featured tutors rank above Premium and Verified, and see who is looking for them.',
      cta: 'See tutor packages',
      href: '/tutor/packages?plan=featured',
    },
    {
      kind: 'house',
      id: 'house-tutor-premium',
      title: 'Message parents first',
      body: 'Premium lets you start the conversation instead of waiting to be found.',
      cta: 'See tutor packages',
      href: '/tutor/packages?plan=premium',
    },
  ],
}

export function houseAd(audience: AdAudience, index = 0): HouseAd {
  const pool = HOUSE_ADS[audience]
  return pool[index % pool.length]
}

type AdRow = {
  id: string
  title: string
  client_name: string | null
  description: string | null
  image_path: string | null
  target_url: string | null
  weight: number
}

/**
 * Pick one active ad for this audience, weighted.
 *
 * Read with the anon-key client on purpose: this runs on public pages, and the
 * policy added in migration 26 already limits the rows to ads that are active
 * and inside their date window. Nothing here has to remember to filter by
 * status -- the database will not hand over anything else. `created_by` is not
 * even selectable with that key.
 */
export async function pickAd(audience: AdAudience): Promise<PaidAd | null> {
  try {
    const supabase = createPublicClient()
    const { data } = await supabase
      .from('advertisements')
      .select('id, title, client_name, description, image_path, target_url, weight')
      .in('audience', [audience, 'both'])
      .limit(100)

    const rows = (data ?? []) as AdRow[]
    if (rows.length === 0) return null

    // Weighted random: lay the weights end to end and drop a point on the line.
    const total = rows.reduce((sum, r) => sum + Math.max(1, r.weight ?? 1), 0)
    let point = Math.random() * total
    let chosen = rows[0]
    for (const r of rows) {
      point -= Math.max(1, r.weight ?? 1)
      if (point <= 0) {
        chosen = r
        break
      }
    }

    return {
      kind: 'paid',
      id: chosen.id,
      title: chosen.title,
      clientName: chosen.client_name || null,
      description: chosen.description || null,
      imageUrl: chosen.image_path ? publicAdUrl(chosen.image_path) : null,
      // Always our redirect, never the advertiser's URL directly: that is
      // where the click is counted, and it is the only place the destination
      // is checked before a visitor is sent to it.
      href: `/api/ads/click/${chosen.id}`,
    }
  } catch {
    // A banner is never worth failing a page for.
    return null
  }
}

export function publicAdUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/ads/${path}`
}

/**
 * Record one impression.
 *
 * Written with the service-role client because ad_events has no INSERT policy
 * at all: if a browser could write these rows, an advertiser's impression
 * count would be a number anyone could type, and reporting it to them would be
 * dishonest. Failures are swallowed -- a missed impression is a rounding
 * error, a 500 on /browse/tutors is not.
 */
export async function recordImpression(
  adId: string,
  slot: AdSlotName,
  viewerRole: string | null,
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin
    .from('ad_events')
    .insert({ ad_id: adId, kind: 'impression', slot, viewer_role: viewerRole })
  if (error) console.error('[ads] impression not recorded', error.message)
}

export async function recordClick(adId: string, viewerRole: string | null): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const { data: ad } = await admin
    .from('advertisements')
    .select('id, target_url, status, starts_at, ends_at')
    .eq('id', adId)
    .maybeSingle()

  if (!ad) return null

  await admin.from('ad_events').insert({ ad_id: adId, kind: 'click', viewer_role: viewerRole })

  return (ad.target_url as string) ?? null
}

/**
 * Is this somewhere we are willing to send a visitor?
 *
 * An advertiser types this URL, and an open redirect on a domain parents trust
 * is worth more to a phisher than the ad slot is to us. http(s) only, and no
 * javascript:, data: or protocol-relative targets.
 */
export function safeTargetUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
