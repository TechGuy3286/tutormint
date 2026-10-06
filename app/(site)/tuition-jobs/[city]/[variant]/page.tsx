import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import CityJobsView, { variantHeading } from '@/components/tuitionJobs/CityJobsView'
import { CITY_PAGE_THRESHOLD, cityPageBySlug, cityPagePath } from '@/lib/cityJobs'
import { seoTitle, seoDescription, socialMeta } from '@/lib/seo'

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
  const heading = variantHeading(page.city, v)
  const title = seoTitle(heading)
  const what = v.kind === 'female' ? 'tuition jobs that need a female tutor' : v.kind === 'online' ? 'online tuition jobs' : `tuition jobs in ${v.area}`
  const description = seoDescription(
    `${v.count} open ${what} in ${page.city}, newest first. Free to browse; verified tutors apply free on TutorMint.`,
  )
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
