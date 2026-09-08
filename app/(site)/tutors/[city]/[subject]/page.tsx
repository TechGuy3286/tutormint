import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import LandingView from '@/components/landing/LandingView'
import { resolveLanding } from '@/lib/landing'
import { pageTitle, pageDescription } from '@/lib/seo'

// /tutors/[city]/[subject] — a city × subject landing page for tutors.
//
// A page exists only where at least LANDING_THRESHOLD listed tutors share the
// combination; resolveLanding returns null below it and this route 404s, so a
// thin page never ships and the sitemap never lists one.
//
// DYNAMIC, with the data on an ISR cache. The route reads through the
// cookie-scoped ranking query (and rank_tutors rotates daily on purpose), so
// it is not a fully static ISR page. What IS cached and revalidated — every
// few hours and on demand when a tutor is listed or unlisted — is the
// combination set behind resolveLanding / the sitemap / the link helper, which
// is what decides whether this page exists at all. See lib/landing.ts.
//
// Indexing is decoupled from preview mode (owner, 8 Sep 2026): there is no
// site-wide noindex, and this page — being listed in the sitemap when it clears
// the threshold — carries no robots key of its own, so it is indexable. Nothing
// extra is needed here.

export const dynamic = 'force-dynamic'

type Params = Promise<{ city: string; subject: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city, subject } = await params
  const combo = await resolveLanding('tutors', city, subject)
  if (!combo) return { title: pageTitle('Tutors') }

  const heading = `${combo.subjectName} tutors in ${combo.city}`
  const lead = `${combo.count} verified ${combo.subjectName} tutor${combo.count === 1 ? '' : 's'} in ${combo.city}`
  return {
    title: pageTitle(heading),
    description: pageDescription(lead),
    alternates: { canonical: `/tutors/${combo.citySlug}/${combo.subjectSlug}` },
    openGraph: { title: pageTitle(heading), description: pageDescription(lead), type: 'website' },
  }
}

export default async function TutorLandingPage({ params }: { params: Params }) {
  const { city, subject } = await params
  const combo = await resolveLanding('tutors', city, subject)
  if (!combo) notFound()
  return <LandingView combo={combo} />
}
