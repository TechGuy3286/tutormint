import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import JobCard from '@/components/JobCard'
import HubFaq from '@/components/seo/HubFaq'
import { hubFactsFrom } from '@/components/tuitionJobs/CityJobsView'
import { hubDescription, hubFaq, hubHeading, hubIntro, hubTitle } from '@/lib/hubCopy'
import { openJobsByIds, slimForCard } from '@/lib/jobFeed'
import { indexableSchoolHubs, schoolGroupBySlug, schoolHubPath, schoolShortName, SCHOOL_HUB_THRESHOLD } from '@/lib/schoolJobs'
import { cityPagePath, indexableCityPagesCached } from '@/lib/cityJobs'
import { itemListJsonLd, jsonLdScript, seoTitle, socialMeta } from '@/lib/seo'
import { absoluteUrl } from '@/lib/siteUrl'
import { citySegment, tuitionPath } from '@/lib/slugs'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'

// /tuition-jobs/school/[school] — "<School> teacher jobs" (owner, 12 Oct 2026).
//
// The open posts that NAME one school (lib/schoolJobsCore: a known school named
// in the title or description, or a title segment that is a school's own name).
// Same rule as the city and area hubs: indexable, in the sitemap and linked from
// 3 open posts; below that it still works for a visitor but is noindex, follow.
// A school no open post names is a 404.

export const dynamic = 'force-dynamic'

type Params = Promise<{ school: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { school } = await params
  const group = await schoolGroupBySlug(school)
  if (!group) return { title: seoTitle('Teacher jobs'), robots: { index: false, follow: true } }
  const count = group.jobIds.length
  const title = hubTitle('school', group.name, count, schoolShortName(group.name))
  const description = hubDescription('school', group.name, { count, areas: [], levels: [], jobTypes: [], budgetMin: null, budgetMax: null })
  const path = schoolHubPath(group.slug)
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(count >= SCHOOL_HUB_THRESHOLD ? {} : { robots: { index: false, follow: true } }),
    ...socialMeta({ title, description, path, type: 'website' }),
  }
}

export default async function SchoolJobsPage({ params }: { params: Params }) {
  const { school } = await params
  const group = await schoolGroupBySlug(school)
  if (!group) notFound()

  const jobs = await openJobsByIds(group.jobIds)
  const cards = jobs.map(slimForCard)
  const count = group.jobIds.length
  const path = schoolHubPath(group.slug)
  const heading = hubHeading('school', group.name)
  const facts = hubFactsFrom(count, jobs)
  const indexable = count >= SCHOOL_HUB_THRESHOLD

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isTutor = user ? (await getEntitlements(user.id)).audience === 'tutor' : false
  const showApply = !user || isTutor

  // Related hubs — only ones that exist: this school's own cities, then the
  // other schools with 3+ open posts.
  const [cityHubs, schoolHubs] = await Promise.all([indexableCityPagesCached(), indexableSchoolHubs()])
  const inCities = cityHubs.filter((c) => group.cities.some((x) => citySegment(x) === c.citySlug))
  const otherSchools = schoolHubs.filter((s) => s.slug !== group.slug).slice(0, 8)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          itemListJsonLd({
            url: absoluteUrl(path),
            name: heading,
            items: cards.map((j) => ({ name: j.headline ?? j.title, url: absoluteUrl(tuitionPath(j)) })),
          }),
        )}
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs items={[{ label: 'Tuition jobs', href: '/browse/tuitions' }, { label: group.name }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">{heading}</h1>
          <p className="max-w-3xl text-xs leading-relaxed text-gray-600 sm:text-sm">{hubIntro('school', group.name, facts)}</p>
        </header>

        {cards.length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-black text-tm-navy">No open posts on this page right now</p>
            <p lang="ur" dir="rtl" className="text-xs text-gray-500">ابھی اس صفحے پر کوئی کھلی اسامی نہیں ہے۔</p>
            <Link href="/browse/tuitions" className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-navy px-5 text-xs font-bold text-white">
              See all open jobs
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {cards.map((job) => (
              <JobCard key={job.id} job={job} signedIn={!!user} showApply={showApply} headingLevel="h2" />
            ))}
          </div>
        )}

        {indexable && cards.length > 0 && <HubFaq items={hubFaq('school', group.name, facts)} path={path} />}

        {(inCities.length > 0 || otherSchools.length > 0) && (
          <nav aria-label="Related job pages" className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            {inCities.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-black text-tm-navy">All teaching jobs by city</p>
                <ul className="flex flex-wrap gap-2">
                  {inCities.map((c) => (
                    <li key={c.citySlug}>
                      <Link href={cityPagePath(c.citySlug)} className="inline-flex min-h-[36px] items-center rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy">
                        {c.city} ({c.count})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {otherSchools.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-black text-tm-navy">Jobs at other schools</p>
                <ul className="flex flex-wrap gap-2">
                  {otherSchools.map((s) => (
                    <li key={s.slug}>
                      <Link href={schoolHubPath(s.slug)} className="inline-flex min-h-[36px] items-center rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy">
                        {s.name} ({s.jobIds.length})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>
        )}
      </div>
    </main>
  )
}
