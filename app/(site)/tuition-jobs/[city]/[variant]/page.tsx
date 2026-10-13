import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import CityJobsView, { variantHub } from '@/components/tuitionJobs/CityJobsView'
import { hubDescription, hubTitle } from '@/lib/hubCopy'
import { CITY_PAGE_THRESHOLD, cityPageBySlug, cityPagePath, retiredAreaValue } from '@/lib/cityJobs'
import { indexableSchoolHubsCached } from '@/lib/schoolJobs'
import { schoolHubPath } from '@/lib/schoolJobsCore'
import { cityFromSegment, slugify } from '@/lib/slugs'
import { seoTitle, socialMeta } from '@/lib/seo'

// /tuition-jobs/[city]/[variant] — female / online / an area (owner, 6 Oct 2026,
// item 6). Same rules as the city page: indexable from 3 open tuitions, noindex
// follow below, 404 only when the variant has no open tuition at all.

export const dynamic = 'force-dynamic'

type Params = Promise<{ city: string; variant: string }>
type Search = Promise<{ page?: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city, variant } = await params
  const page = await cityPageBySlug(city)
  const v = page?.variants.find((x) => x.slug === variant) ?? null
  if (!page || !v) return { title: seoTitle('Tuition jobs'), robots: { index: false, follow: true } }
  // "Teaching Jobs in <Area>, <City> – <N> Open | TutorMint" (owner, 12 Oct 2026).
  const hub = variantHub(page.city, v)
  const title = hubTitle(hub.kind, hub.name, v.count)
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

export default async function CityVariantPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ city, variant }, sp] = await Promise.all([params, searchParams])
  const page = await cityPageBySlug(city)
  const v = page?.variants.find((x) => x.slug === variant) ?? null
  if (!v) {
    // Not a hub of this city (owner, 13 Oct 2026). An address a tuition's saved
    // area once made — a school's name, a street address, an area that is not in
    // Locations — is sent on, permanently: to the school's hub when it has one,
    // else to the city hub. (A merged AREA is a 301 in proxy.ts before this
    // runs.) An address nothing ever made is a real 404.
    const cityName = page?.city ?? cityFromSegment(city)
    const retired = cityName ? await retiredAreaValue(cityName, variant) : null
    if (!retired) notFound()
    if (retired.school) {
      const slug = slugify(retired.school)
      const hubs = await indexableSchoolHubsCached().catch(() => [])
      if (hubs.some((h) => h.slug === slug)) permanentRedirect(schoolHubPath(slug))
    }
    // Any curated-area hub is kept even when it has no open tuition today.
    permanentRedirect(page ? cityPagePath(page.citySlug) : '/browse/tuitions')
  }
  if (!page) notFound()
  const n = Math.max(1, Math.floor(Number(sp.page) || 1))
  return <CityJobsView page={page} variant={v} pageNo={n} />
}
