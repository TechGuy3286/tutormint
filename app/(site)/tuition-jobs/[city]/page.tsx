import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityJobsView, { variantHub } from '@/components/tuitionJobs/CityJobsView'
import { hubDescription, hubTitle } from '@/lib/hubCopy'
import { CITY_PAGE_THRESHOLD, cityPageBySlug, cityPagePath } from '@/lib/cityJobs'
import { seoTitle, socialMeta } from '@/lib/seo'

// /tuition-jobs/[city] — "Tuition jobs in [City]" (owner, 6 Oct 2026, item 6).
// Server-rendered; indexable (and in the sitemap) from 3 open tuitions, noindex
// follow below that — it becomes indexable by itself once it reaches 3. A city
// with no open tuition at all is a 404.

export const dynamic = 'force-dynamic'

type Params = Promise<{ city: string }>
type Search = Promise<{ page?: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city } = await params
  const page = await cityPageBySlug(city)
  if (!page) return { title: seoTitle('Tuition jobs'), robots: { index: false, follow: true } }
  // "Tuition & Teaching Jobs in <City> – <N> Open | TutorMint" (owner, 12 Oct 2026).
  const hub = variantHub(page.city, null)
  const title = hubTitle(hub.kind, hub.name, page.count)
  const description = hubDescription(hub.kind, hub.name, { count: page.count, areas: [], levels: [], jobTypes: [], budgetMin: null, budgetMax: null })
  const path = cityPagePath(page.citySlug)
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(page.count >= CITY_PAGE_THRESHOLD ? {} : { robots: { index: false, follow: true } }),
    ...socialMeta({ title, description, path, type: 'website' }),
  }
}

export default async function CityTuitionJobsPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ city }, sp] = await Promise.all([params, searchParams])
  const page = await cityPageBySlug(city)
  if (!page) notFound()
  const n = Math.max(1, Math.floor(Number(sp.page) || 1))
  return <CityJobsView page={page} variant={null} pageNo={n} />
}
