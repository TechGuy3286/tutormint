import { notFound, permanentRedirect } from 'next/navigation'
import CityJobsView from '@/components/tuitionJobs/CityJobsView'
import { cityPageBySlug, cityPagePath, retiredAreaValue } from '@/lib/cityJobs'
import { indexableSchoolHubsCached } from '@/lib/schoolJobs'
import { schoolHubPath } from '@/lib/schoolJobsCore'
import { cityFromSegment, slugify } from '@/lib/slugs'

/** A city hub variant, shared by the cached page and its /qs query twin (push 3). */
export async function renderVariantPage(city: string, variant: string, pageNo: number) {
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
  return <CityJobsView page={page} variant={v} pageNo={pageNo} />
}

