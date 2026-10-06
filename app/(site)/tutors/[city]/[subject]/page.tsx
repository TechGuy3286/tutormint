import type { Metadata } from 'next'
import { liveOverlapNoindex, overlapKey } from '@/lib/landingOverlap'
import { notFound } from 'next/navigation'

import LandingView from '@/components/landing/LandingView'
import { resolveLandingAny, landingIndexable } from '@/lib/landing'
import { pageTitle, pageDescription, socialMeta, seoTitle, seoDescription } from '@/lib/seo'

// /tutors/[city]/[subject] — a city × subject landing page for tutors.
//
// The page renders for any city × subject with at least one listed tutor
// (owner, 5 Oct 2026, item 6). Below LANDING_THRESHOLD (3) it carries
// `noindex, follow` and is left out of the sitemap; at 3 or more it is indexable
// and listed. Both decisions read the LIVE combination set (resolveLandingAny /
// liveLandingPagesUncached), so the page and the sitemap can never disagree.
// Only a combination with no listing at all is a 404.
//
// DYNAMIC: the route reads through the cookie-scoped ranking query (and
// rank_tutors rotates daily on purpose). See lib/landing.ts.

export const dynamic = 'force-dynamic'

type Params = Promise<{ city: string; subject: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city, subject } = await params
  const combo = await resolveLandingAny('tutors', city, subject)
  if (!combo) return { title: pageTitle('Tutors'), robots: { index: false, follow: true } }

  const heading = `${combo.subjectName} tutors in ${combo.city}`
  const lead = `${combo.count} verified ${combo.subjectName} tutor${combo.count === 1 ? '' : 's'} in ${combo.city}`
  // ≤ 60 characters (owner, 6 Oct 2026); description ≤ 155.
  const title = seoTitle(heading)
  const description = seoDescription(pageDescription(lead))
  // Near-duplicate of a broader page in this city (item 13): noindex, follow.
  const overlap = (await liveOverlapNoindex()).has(overlapKey('tutors', combo.citySlug, combo.masterId))
  return {
    title,
    description,
    alternates: { canonical: `/tutors/${combo.citySlug}/${combo.subjectSlug}` },
    // Fewer than 3 results, or an 80%+ overlap with a broader page: noindex,
    // follow. Both lift by themselves as the data changes.
    ...(landingIndexable(combo) && !overlap ? {} : { robots: { index: false, follow: true } }),
    // Branded default image — a landing page has no imagery of its own.
    ...socialMeta({
      title,
      description,
      path: `/tutors/${combo.citySlug}/${combo.subjectSlug}`,
      type: 'website',
    }),
  }
}

export default async function TutorLandingPage({ params }: { params: Params }) {
  const { city, subject } = await params
  const combo = await resolveLandingAny('tutors', city, subject)
  if (!combo) notFound()
  return <LandingView combo={combo} />
}
