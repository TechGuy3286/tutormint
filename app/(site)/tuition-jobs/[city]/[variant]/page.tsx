import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import CityJobsView, { variantHub } from '@/components/tuitionJobs/CityJobsView'
import { hubDescription, hubTitle } from '@/lib/hubCopy'
import { CITY_PAGE_THRESHOLD, cityPageBySlug, cityPagePath, retiredAreaValue } from '@/lib/cityJobs'
import { indexableSchoolHubsCached } from '@/lib/schoolJobs'
import { schoolHubPath } from '@/lib/schoolJobsCore'
import { cityFromSegment, slugify } from '@/lib/slugs'
import { seoTitle, socialMeta } from '@/lib/seo'
import { renderVariantPage } from './render'
import { femalePageTitle } from '@/lib/femaleJobsCore'

// /tuition-jobs/[city]/[variant] — female / online / an area (owner, 6 Oct 2026,
// item 6). Same rules as the city page: indexable from 3 open tuitions, noindex
// follow below, 404 only when the variant has no open tuition at all.

// Cached for everyone (push 3, owner 1 Nov 2026): rebuilt when one of its
// tuitions changes (revalidatePath via lib/publicRevalidate) and at most every
// 10 minutes. ?page= is sent to the twin under /qs by proxy.ts, so this page
// never reads the query.
export const revalidate = 600
export async function generateStaticParams() {
  return []
}

type Params = Promise<{ city: string; variant: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city, variant } = await params
  const page = await cityPageBySlug(city)
  const v = page?.variants.find((x) => x.slug === variant) ?? null
  if (!page || !v) return { title: seoTitle('Tuition jobs'), robots: { index: false, follow: true } }
  // "Teaching Jobs in <Area>, <City> – <N> Open | TutorMint" (owner, 12 Oct 2026).
  const hub = variantHub(page.city, v)
  // The female page carries the owner's exact title (28 Oct 2026), even past 60 characters.
  const title = v.kind === 'female' ? femalePageTitle(page.city) : hubTitle(hub.kind, hub.name, v.count)
  const description = hubDescription(hub.kind, hub.name, { count: v.count, areas: [], levels: [], jobTypes: [], budgetMin: null, budgetMax: null })
  const path = cityPagePath(page.citySlug, v.slug)
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(v.count >= CITY_PAGE_THRESHOLD ? {} : { robots: { index: false, follow: true } }),
    ...socialMeta({ title, description, path, type: 'website' }),
  }
}

export default async function CityVariantPage({ params }: { params: Params }) {
  const { city, variant } = await params
  return renderVariantPage(city, variant, 1)
}
