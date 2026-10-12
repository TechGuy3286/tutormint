import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityJobsView, { variantHub } from '@/components/tuitionJobs/CityJobsView'
import { hubDescription, hubTitle } from '@/lib/hubCopy'
import { CITY_PAGE_THRESHOLD, cityPageBySlug, cityPagePath } from '@/lib/cityJobs'
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
  if (!page || !v) notFound()
  const n = Math.max(1, Math.floor(Number(sp.page) || 1))
  return <CityJobsView page={page} variant={v} pageNo={n} />
}
