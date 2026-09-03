import Link from 'next/link'

import { type HouseAd, type PaidAd } from '@/lib/ads'

// What an ad LOOKS like, with no opinion about where it came from.
//
// Split out of AdSlot because an ad now reaches the page two ways: rendered on
// the server for the first window of results, and fetched by the browser for
// the windows that infinite scroll appends. Both must produce the same markup
// and, above all, the same LABEL — a paid ad says "Sponsored", a house ad says
// "TutorMint", and calling our own upsell sponsored would be untrue.
//
// So the label is decided here, once, from the ad's own kind. Two copies of
// this markup would be two chances for one of them to drift.
//
// Picking the ad and recording the impression stay on the server in both paths.
// This component records nothing: it is handed an ad that has already been
// counted, so it cannot count one twice by re-rendering.

export default function AdView({ ad }: { ad: { kind: 'paid'; ad: PaidAd } | { kind: 'house'; ad: HouseAd } }) {
  if (ad.kind === 'paid') {
    const paid = ad.ad
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
            <img src={paid.imageUrl} alt="" className="h-auto w-full object-cover" loading="lazy" />
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

  const house = ad.ad
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
