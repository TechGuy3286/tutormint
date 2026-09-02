import Link from 'next/link'
import { pickAd, houseAd, recordImpression, type AdAudience, type AdSlotName } from '@/lib/ads'

// An ad slot. There are exactly three placements in the whole product:
//
//   browse-inline     after every 8 results on /browse/tutors and
//                     /browse/tuitions
//   parent-sidebar    the parent dashboard
//   tutor-dashboard   the tutor dashboard (house / promo creatives only)
//
// The homepage has none, deliberately: it is partner-approved and locked, and
// an ad slot is not one of the permitted changes.
//
// A server component, so the impression is recorded where the ad is actually
// chosen. That also means a paid ad never reaches the browser as a row of data
// a client could re-render, re-count or reorder.
//
// LABELS. A paid ad is labelled "Sponsored". A house ad -- our own package
// upsell -- is labelled "TutorMint". The label is taken from the ad's kind, so
// a caller cannot dress our marketing up as somebody else's, or the reverse.

export default async function AdSlot({
  slot,
  audience = 'parents',
  /** Rotates the house creative so two slots on one page are not identical. */
  index = 0,
  viewerRole = null,
}: {
  slot: AdSlotName
  audience?: AdAudience
  index?: number
  viewerRole?: string | null
}) {
  // The tutor dashboard carries house and promo creatives only (revenue spec),
  // so it is not offered to the paid rotation at all.
  const paid = slot === 'tutor-dashboard' ? null : await pickAd(audience)

  if (paid) {
    await recordImpression(paid.id, slot, viewerRole)

    return (
      <aside
        aria-label="Sponsored"
        className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
      >
        <Link href={paid.href} rel="nofollow sponsored noopener" className="block">
          {paid.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- an
            // advertiser's creative is an arbitrary remote URL; running it
            // through the image optimiser would let an ad buy CPU on our
            // servers by uploading a very large file.
            <img
              src={paid.imageUrl}
              alt=""
              className="h-auto w-full object-cover"
              loading="lazy"
            />
          )}
          <div className="space-y-1 p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">
              Sponsored{paid.clientName ? ` · ${paid.clientName}` : ''}
            </p>
            <h3 className="text-sm font-black text-tm-navy">{paid.title}</h3>
            {paid.description && (
              <p className="text-xs leading-relaxed text-slate-700">{paid.description}</p>
            )}
          </div>
        </Link>
      </aside>
    )
  }

  const house = houseAd(audience, index)

  return (
    <aside
      aria-label="TutorMint"
      className="rounded-2xl border border-dashed border-tm-gold/50 bg-tm-tint-gold p-4 sm:p-6"
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-tm-gold-ink">TutorMint</p>
      <h3 className="pt-1 text-sm font-black text-tm-navy">{house.title}</h3>
      <p className="pt-1 text-xs leading-relaxed text-slate-700">{house.body}</p>
      <Link
        href={house.href}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy"
      >
        {house.cta}
      </Link>
    </aside>
  )
}
