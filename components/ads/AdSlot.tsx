import Link from 'next/link'

// An inline ad slot in a results list. One appears after every 8 results on
// /browse/tutors and /browse/tuitions -- the only inline placement there is.
//
// T4 renders the house creatives only. Real rotation (weighted random over the
// `advertisements` table, impression and click counting, admin CRUD) is T7;
// this component is the slot those ads will fill, so the layout does not have
// to change when they arrive.
//
// Two rules from the revenue spec that this file exists to enforce:
//
//   * Ads NEVER appear as tutor cards and never enter search ranking.
//     Ranking is sold through plans; ads are banners. A tutor who pays for
//     Featured must not find an advertiser sitting above them.
//   * Every ad carries a visible label. A house ad is labelled "TutorMint",
//     not "Sponsored" -- calling our own upsell sponsored would be untrue.

type HouseAd = {
  audience: 'parents' | 'tutors'
  eyebrow: string
  title: string
  body: string
  cta: string
  href: string
}

const HOUSE_ADS: HouseAd[] = [
  {
    audience: 'parents',
    eyebrow: 'TutorMint Featured',
    title: 'See tutor contact details instantly',
    body: 'Featured parents view phone and WhatsApp, message any tutor, and complete hires.',
    cta: 'See parent packages',
    href: '/parent/packages',
  },
  {
    audience: 'tutors',
    eyebrow: 'TutorMint Featured',
    title: 'Reach the top of every search',
    body: 'Featured tutors rank above Premium and Verified, and see who is looking for them.',
    cta: 'See tutor packages',
    href: '/tutor/packages',
  },
]

export default function AdSlot({
  audience = 'parents',
  /** Rotates the house creative so the same slot is not identical down a page. */
  index = 0,
}: {
  audience?: 'parents' | 'tutors'
  index?: number
}) {
  const pool = HOUSE_ADS.filter((a) => a.audience === audience)
  const ad = pool[index % pool.length] ?? HOUSE_ADS[0]

  return (
    <aside
      aria-label="Advertisement"
      className="rounded-2xl border border-dashed border-[#F59E0B]/50 bg-[#FFFBEB] p-4 sm:p-6"
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-[#B45309]">TutorMint</p>
      <h3 className="pt-1 text-sm font-black text-[#0F172A]">{ad.title}</h3>
      <p className="pt-1 text-xs leading-relaxed text-[#334155]">{ad.body}</p>
      <Link
        href={ad.href}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0F172A] px-4 text-xs font-bold text-white transition-colors hover:bg-[#1E293B]"
      >
        {ad.cta}
      </Link>
    </aside>
  )
}
