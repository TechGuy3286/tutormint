import Link from 'next/link'
import { Briefcase, GraduationCap } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import TutorCard, { type CardViewer } from '@/components/TutorCard'
import MoreLandingTutors from '@/components/landing/MoreLandingTutors'
import PageLinks from '@/components/seo/PageLinks'
import { rankedTutors } from '@/lib/browseTutors'
import { tutorPath } from '@/lib/slugs'
import { absoluteUrl } from '@/lib/siteUrl'
import { collectionPageJsonLd, jsonLdScript } from '@/lib/seo'
import { formatName } from '@/lib/formatName'
import { uniqueById } from '@/lib/infiniteMerge'
import { liveLandingPages } from '@/lib/landing'
import { cityPagePath, indexableCityPagesCached } from '@/lib/cityJobs'
import { loadCrawlSet } from '@/lib/tutorCrawl'
import {
  CITY_TUTORS_PAGE_SIZE,
  cityTutorPageIndexable,
  cityTutorPath,
  femaleTutorPageIndexable,
  pageCount,
  type TutorCity,
} from '@/lib/tutorCrawlCore'

// /tutors/<city> and /tutors/<city>/female (owner, 20 Nov 2026 — PR-11): a
// crawlable list of the city's tutors, rendered on the server, with numbered
// page links (?page=2, 3 …) under "Load more", breadcrumbs, and links to the
// city's subject pages, its female variant, other cities and its tuition jobs.
// Indexable from 3 indexable tutors (paid + CNIC and photo approved); below
// that the page still works and is noindex, follow. No price anywhere.

const GUEST: CardViewer = { signedIn: false, role: null, verifiedParent: false, canInitiateMessage: false }

const CHIP = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy'

export function cityTutorsHeading(city: string, female: boolean): string {
  return female ? `Female tutors in ${city}` : `Tutors in ${city}`
}

export default async function CityTutorsView({ city, female, page }: { city: TutorCity; female: boolean; page: number }) {
  const path = cityTutorPath(city.citySlug, female)
  const heading = cityTutorsHeading(city.city, female)
  const params: Record<string, string> = { city: city.city, ...(female ? { gender: 'female' } : {}) }
  const { tutors: rows, total, nextCursor } = await rankedTutors({
    filters: { masterId: null, city: city.city, area: '', mode: '', gender: female ? 'female' : '', feeMin: '', feeMax: '', q: '' },
    limit: CITY_TUTORS_PAGE_SIZE,
    offset: (page - 1) * CITY_TUTORS_PAGE_SIZE,
  })
  const tutors = uniqueById(rows)
  const pages = pageCount(total)

  const [landing, crawl, cityHubs] = await Promise.all([
    liveLandingPages().catch(() => []),
    loadCrawlSet().catch(() => ({ tutors: [], cities: [] as TutorCity[] })),
    indexableCityPagesCached().catch(() => []),
  ])
  const subjectPages = landing.filter((p) => p.kind === 'tutors' && p.citySlug === city.citySlug).slice(0, 12)
  const otherCities = crawl.cities.filter((c) => c.citySlug !== city.citySlug && cityTutorPageIndexable(c)).slice(0, 12)
  const hub = cityHubs.find((p) => p.citySlug === city.citySlug) ?? null
  const showFemale = !female && femaleTutorPageIndexable(city)

  const intro = female
    ? `Female tutors in ${city.city} on TutorMint. Browse their profiles, subjects and levels — free to browse, no account needed.`
    : `Tutors in ${city.city} on TutorMint. Browse their profiles, subjects and levels — free to browse, no account needed.`
  const itemList = tutors
    .map((t) => (t.slug ? { name: formatName(t.full_name), url: absoluteUrl(tutorPath(t.slug) ?? '') } : null))
    .filter((x): x is { name: string; url: string } => !!x)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(collectionPageJsonLd({ name: heading, url: absoluteUrl(page > 1 ? `${path}?page=${page}` : path), description: intro, items: itemList }))}
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Tutors', href: '/browse/tutors' },
            ...(female ? [{ label: `Tutors in ${city.city}`, href: cityTutorPath(city.citySlug) }] : []),
            { label: female ? 'Female tutors' : `Tutors in ${city.city}` },
          ]}
        />
        <header className="space-y-2">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">
            {heading}
            {page > 1 ? ` — page ${page}` : ''}
          </h1>
          <p className="max-w-3xl text-xs leading-relaxed text-gray-600 sm:text-sm">{intro}</p>
        </header>

        {tutors.length === 0 ? (
          <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-sm font-bold text-tm-navy">No tutors listed here yet</p>
            <p className="text-xs text-gray-600">Post your tuition and let tutors in {city.city} come to you, or browse every tutor.</p>
            <Link href="/browse/tutors" className="inline-flex min-h-[44px] items-center text-xs font-bold text-tm-navy underline">
              Find tutors
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {tutors.map((t, i) => (
              <TutorCard key={t.id} tutor={t} viewer={GUEST} initiallySaved={false} showMessage headingLevel="h2" priority={i === 0} />
            ))}
          </div>
        )}

        {tutors.length > 0 && (
          <MoreLandingTutors params={{ ...params, ...(page > 1 ? { page: String(page) } : {}) }} initialCursor={nextCursor} viewer={GUEST} serverIds={tutors.map((t) => t.id)} />
        )}
        {/* Numbered pages for crawlers ("Load more" stays for people). */}
        <PageLinks path={path} page={page} pages={pages} label={`Pages of ${heading.toLowerCase()}`} />

        <nav aria-label={`More about tutors in ${city.city}`} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          {(showFemale || female || hub) && (
            <ul className="flex flex-wrap gap-2">
              {showFemale && (
                <li>
                  <Link href={cityTutorPath(city.citySlug, true)} className={CHIP}>
                    <GraduationCap aria-hidden size={12} /> Female tutors in {city.city}
                  </Link>
                </li>
              )}
              {female && (
                <li>
                  <Link href={cityTutorPath(city.citySlug)} className={CHIP}>
                    <GraduationCap aria-hidden size={12} /> All tutors in {city.city}
                  </Link>
                </li>
              )}
              {hub && (
                <li>
                  <Link href={cityPagePath(hub.citySlug)} className={CHIP}>
                    <Briefcase aria-hidden size={12} /> Tuition jobs in {city.city}
                  </Link>
                </li>
              )}
            </ul>
          )}
          {subjectPages.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-black text-tm-navy">Subjects in {city.city}</p>
              <ul className="flex flex-wrap gap-2">
                {subjectPages.map((p) => (
                  <li key={p.subjectSlug}>
                    <Link href={`/tutors/${p.citySlug}/${p.subjectSlug}`} className={CHIP}>
                      {p.subjectName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {otherCities.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-black text-tm-navy">Tutors in other cities</p>
              <ul className="flex flex-wrap gap-2">
                {otherCities.map((c) => (
                  <li key={c.citySlug}>
                    <Link href={cityTutorPath(c.citySlug)} className={CHIP}>
                      {c.city}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>
      </div>
    </main>
  )
}
