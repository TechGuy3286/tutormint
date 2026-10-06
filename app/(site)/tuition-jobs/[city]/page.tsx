import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityJobsView, { CITY_PAGE_SIZE, variantHeading } from '@/components/tuitionJobs/CityJobsView'
import { CITY_PAGE_THRESHOLD, cityPageBySlug, cityPagePath } from '@/lib/cityJobs'
import { seoTitle, seoDescription, socialMeta } from '@/lib/seo'

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
  const heading = variantHeading(page.city, null)
  const title = seoTitle(heading)
  const description = seoDescription(
    `${page.count} open home and online tuition job${page.count === 1 ? '' : 's'} in ${page.city}, newest first. Free to browse; verified tutors apply free on TutorMint.`,
  )
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
  void CITY_PAGE_SIZE
  return <CityJobsView page={page} variant={null} pageNo={n} />
}
