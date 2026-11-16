import { notFound, permanentRedirect } from 'next/navigation'
import CityJobsView from '@/components/tuitionJobs/CityJobsView'
import { cityPageBySlug, cityPagePath, knownCityBySlug, retiredAreaValue } from '@/lib/cityJobs'
import { indexableSchoolHubsCached } from '@/lib/schoolJobs'
import { schoolHubPath } from '@/lib/schoolJobsCore'
import { citySegment, slugify } from '@/lib/slugs'

/** A city hub variant, shared by the cached page and its /qs query twin (push 3). */
export async function renderVariantPage(city: string, variant: string, pageNo: number) {
  const page = await cityPageBySlug(city)
  const v = page?.variants.find((x) => x.slug === variant) ?? null
  if (!v) {
    // Not a hub of this city (owner, 13 Oct 2026). An address a tuition's saved
    // area once made — a school's name, a street address, an area that is not in
    // Locations — is sent on, permanently: to the school's hub when it has one,
    // else to the city hub. (A merged AREA is a 301 in proxy.ts before this
    // runs.) Owner, 16 Nov 2026: any other address under a KNOWN city — a female
    // or online page with no open tuition today (/tuition-jobs/mianwali/female)
    // — goes to the city page, which always exists for a known city. Only an
    // address under a city nobody ever used is a 404.
    const cityName = page?.city ?? (await knownCityBySlug(city))
    if (!cityName) notFound()
    const retired = await retiredAreaValue(cityName, variant)
    if (retired?.school) {
      const slug = slugify(retired.school)
      const hubs = await indexableSchoolHubsCached().catch(() => [])
      if (hubs.some((h) => h.slug === slug)) permanentRedirect(schoolHubPath(slug))
    }
    permanentRedirect(cityPagePath(page?.citySlug ?? citySegment(cityName)))
  }
  if (!page) notFound()
  return <CityJobsView page={page} variant={v} pageNo={pageNo} />
}
