import Link from 'next/link'
import { Briefcase, MapPin, Wifi, UserRound } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import JobCard from '@/components/JobCard'
import MoreJobs from '@/app/(site)/browse/tuitions/MoreJobs'
import { browseJobs, slimForCard, type JobFilters } from '@/lib/jobFeed'
import { absoluteUrl } from '@/lib/siteUrl'
import { itemListJsonLd, jsonLdScript } from '@/lib/seo'
import { tuitionPath } from '@/lib/slugs'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import { CITY_PAGE_THRESHOLD, cityPagePath, type CityPage, type CityVariant } from '@/lib/cityJobs'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'

// "Tuition jobs in [City]" (owner, 6 Oct 2026, item 6) — the city page and its
// variants (female / online / an area), one server-rendered component.
//
// Honest intro: the live open count, nothing invented. All open tuitions in the
// city newest first (bumped_at), the first window in the HTML and ?page=N
// resolving server-side for crawlers; MoreJobs appends the rest. ItemList +
// BreadcrumbList structured data; the caller sets the canonical/title/meta.

export const CITY_PAGE_SIZE = 12

export function variantFilters(citySlug: string, city: string, variant: CityVariant | null): JobFilters {
  return {
    masterId: null,
    city,
    mode: variant?.kind === 'online' ? ONLINE_JOB_TITLE : null,
    budgetMin: null,
    budgetMax: null,
    q: null,
    tutorScope: null,
    viewerGender: null,
    area: variant?.kind === 'area' ? (variant.area ?? null) : null,
    genderPreference: variant?.kind === 'female' ? 'female' : null,
  }
}

export function variantHeading(city: string, variant: CityVariant | null): string {
  if (!variant) return `Tuition jobs in ${city}`
  if (variant.kind === 'female') return `Tuition jobs for female tutors in ${city}`
  if (variant.kind === 'online') return `Online tuition jobs in ${city}`
  return `Tuition jobs in ${variant.area}, ${city}`
}

export default async function CityJobsView({
  page,
  variant,
  pageNo,
}: {
  page: CityPage
  variant: CityVariant | null
  pageNo: number
}) {
  const filters = variantFilters(page.citySlug, page.city, variant)
  const { jobs: fullJobs, total, nextCursor } = await browseJobs(filters, CITY_PAGE_SIZE, (pageNo - 1) * CITY_PAGE_SIZE)
  const jobs = fullJobs.map(slimForCard)
  const path = cityPagePath(page.citySlug, variant?.slug ?? null)
  const heading = variantHeading(page.city, variant)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let isTutor = false
  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'
  }
  const showApply = !user || isTutor

  const count = total
  const intro =
    count === 0
      ? `There are no open tuitions here right now. New ones are posted most days — the list below updates as they arrive.`
      : `${count} open tuition${count === 1 ? '' : 's'} ${variant ? `match${count === 1 ? 'es' : ''} this page` : `in ${page.city}`} right now, newest first. Browsing is free and needs no account; a verified tutor can apply from the card.`

  // Variant links: the other pages in this city that exist (3+ open tuitions).
  const liveVariants = page.variants.filter((v) => v.count >= CITY_PAGE_THRESHOLD && v.slug !== variant?.slug)

  const crumbs = [
    { label: 'Find tuitions', href: '/browse/tuitions' },
    ...(variant ? [{ label: `Tuition jobs in ${page.city}`, href: cityPagePath(page.citySlug) }, { label: variant.kind === 'area' ? (variant.area ?? variant.label) : variant.label }] : [{ label: `Tuition jobs in ${page.city}` }]),
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          itemListJsonLd({
            url: absoluteUrl(path),
            name: heading,
            items: jobs.map((j) => ({ name: j.headline ?? j.title, url: absoluteUrl(tuitionPath(j)) })),
          }),
        )}
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs items={crumbs} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">{heading}</h1>
          <p className="max-w-3xl text-xs leading-relaxed text-gray-600 sm:text-sm">{intro}</p>
        </header>

        {liveVariants.length > 0 && (
          <nav aria-label={`More tuition pages in ${page.city}`} className="flex flex-wrap gap-2">
            {variant && (
              <Link href={cityPagePath(page.citySlug)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy">
                <Briefcase aria-hidden size={12} /> All tuitions in {page.city}
              </Link>
            )}
            {liveVariants.slice(0, 14).map((v) => (
              <Link
                key={v.slug}
                href={cityPagePath(page.citySlug, v.slug)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy"
              >
                {v.kind === 'online' ? <Wifi aria-hidden size={12} /> : v.kind === 'female' ? <UserRound aria-hidden size={12} /> : <MapPin aria-hidden size={12} />}
                {v.label} ({v.count})
              </Link>
            ))}
          </nav>
        )}

        {jobs.length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-black text-tm-navy">No open tuitions on this page yet</p>
            <p lang="ur" dir="rtl" className="text-xs text-gray-500">ابھی اس صفحے پر کوئی کھلی ٹیوشن نہیں ہے۔</p>
            <Link href="/browse/tuitions" className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-navy px-5 text-xs font-bold text-white">
              See all open tuitions
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} signedIn={!!user} showApply={showApply} headingLevel="h2" />
              ))}
            </div>
            <MoreJobs
              params={{
                city: page.city,
                ...(variant?.kind === 'online' ? { mode: ONLINE_JOB_TITLE } : {}),
                ...(variant?.kind === 'female' ? { gender: 'female' } : {}),
                ...(variant?.kind === 'area' && variant.area ? { area: variant.area } : {}),
                ...(pageNo > 1 ? { page: String(pageNo) } : {}),
              }}
              initialCursor={nextCursor}
              total={total}
              serverCount={(pageNo - 1) * CITY_PAGE_SIZE + jobs.length}
              signedIn={!!user}
              showApply={showApply}
              adEvery={100000}
              viewerCity={null}
              viewerCities={null}
              viewerJobTypes={null}
              saveable={isTutor}
              savedIds={[]}
            />
          </>
        )}
      </div>
    </main>
  )
}
