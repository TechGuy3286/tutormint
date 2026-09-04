import Link from 'next/link'
import { GraduationCap, Briefcase, Plus, UserPlus } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import TutorCard, { type CardViewer } from '@/components/TutorCard'
import JobCard from '@/components/JobCard'
import MoreLandingTutors from '@/components/landing/MoreLandingTutors'
import MoreLandingJobs from '@/components/landing/MoreLandingJobs'
import TutorFilterBar from '@/app/(site)/browse/tutors/TutorFilterBar'
import JobFilterBar from '@/app/(site)/browse/tuitions/JobFilterBar'
import { rankedTutors } from '@/lib/browseTutors'
import { browseJobs } from '@/lib/jobFeed'
import { tutorPath, tuitionPath } from '@/lib/slugs'
import { absoluteUrl } from '@/lib/siteUrl'
import { itemListJsonLd, jsonLdScript } from '@/lib/seo'
import { buildIntro, liveLandingPages, type LandingCombo, type IntroFacts } from '@/lib/landing'
import { article } from '@/lib/article'

// The city × subject landing page, one component for both kinds. It is server-
// rendered from data: the H1, the intro sentence, the ranked list, the
// neighbour links and the ItemList JSON-LD are all built from the same query,
// so every page differs from the next and none links to a page that is absent.
//
// Rendered as a GUEST on purpose: the page is ISR/cached, and the transactional
// buttons open the sign-in modal, which is the right next step from a page a
// stranger arrived on from search.

const GUEST: CardViewer = {
  signedIn: false,
  role: null,
  verifiedParent: false,
  canInitiateMessage: false,
}

const PAGE_SIZE = 12

function distinct(values: (string | null | undefined)[], max = 4): string[] {
  const out: string[] = []
  for (const v of values) {
    const t = (v ?? '').trim()
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/**
 * The clean mode phrases present, for the intro. `both` is a tutor who does
 * either, so it contributes both "online" and "in person" — rendering it as
 * its own word ("either") next to "in person" reads as a third, redundant mode.
 */
function modeWords(raw: (string | null | undefined)[]): string[] {
  const s = new Set<string>()
  for (const m of raw) {
    if (m === 'both') {
      s.add('online')
      s.add('in person')
    } else if (m === 'online') s.add('online')
    else if (m === 'in_person') s.add('in person')
  }
  return [...s]
}

export default async function LandingView({ combo }: { combo: LandingCombo }) {
  const { kind, city, citySlug, masterId, subjectSlug, subjectName } = combo
  const isTutors = kind === 'tutors'
  const canonical = `/${kind}/${citySlug}/${subjectSlug}`
  const heading = `${subjectName} ${isTutors ? 'tutors' : 'tuitions'} in ${city}`

  // Neighbour links, from the live set only — every one resolves.
  const pages = await liveLandingPages()
  const inCity = pages
    .filter((p) => p.kind === kind && p.citySlug === citySlug && p.subjectSlug !== subjectSlug)
    .slice(0, 8)
  const inOtherCities = pages
    .filter((p) => p.kind === kind && p.subjectSlug === subjectSlug && p.citySlug !== citySlug)
    .slice(0, 8)

  const params = { subject: String(masterId), city }

  // The list, plus the facts the intro is built from.
  let intro: string
  let itemList: { name: string; url: string }[]
  let firstWindow: React.ReactNode
  let initialCursor: string | null
  let total: number

  if (isTutors) {
    const { tutors, total: t, nextCursor } = await rankedTutors({
      filters: { masterId, city, area: '', mode: '', gender: '', feeMin: '', feeMax: '', q: '' },
      limit: PAGE_SIZE,
    })
    total = t
    initialCursor = nextCursor
    const fees = tutors.map((x) => x.hourly_rate_pkr).filter((n): n is number => typeof n === 'number' && n > 0)
    const facts: IntroFacts = {
      count: total,
      feeMin: fees.length ? Math.min(...fees) : null,
      feeMax: fees.length ? Math.max(...fees) : null,
      modes: modeWords(tutors.map((x) => x.teaching_mode)),
      areas: distinct(tutors.map((x) => x.area)),
    }
    intro = buildIntro('tutors', subjectName, city, facts)
    itemList = tutors
      .map((x) => (x.slug ? { name: x.full_name, url: absoluteUrl(tutorPath(x.slug) ?? '') } : null))
      .filter((x): x is { name: string; url: string } => !!x)
    firstWindow = (
      <div className="space-y-4">
        {tutors.map((t) => (
          <TutorCard key={t.id} tutor={t} viewer={GUEST} initiallySaved={false} showMessage />
        ))}
      </div>
    )
  } else {
    const { jobs, total: t, nextCursor } = await browseJobs(
      { masterId, city, mode: null, budgetMin: null, budgetMax: null, q: null },
      PAGE_SIZE,
    )
    total = t
    initialCursor = nextCursor
    const mins = jobs
      .map((j) => j.budget_min_pkr ?? j.budget_pkr)
      .filter((n): n is number => typeof n === 'number' && n > 0)
    const maxs = jobs
      .map((j) => j.budget_max_pkr ?? j.budget_pkr)
      .filter((n): n is number => typeof n === 'number' && n > 0)
    const facts: IntroFacts = {
      count: total,
      feeMin: mins.length ? Math.min(...mins) : null,
      feeMax: maxs.length ? Math.max(...maxs) : null,
      modes: modeWords(jobs.map((j) => j.teaching_mode)),
      areas: distinct(jobs.map((j) => j.area)),
    }
    intro = buildIntro('tuitions', subjectName, city, facts)
    itemList = jobs.map((j) => ({ name: j.title, url: absoluteUrl(tuitionPath(j)) }))
    firstWindow = (
      <div className="space-y-4">
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} signedIn={false} showApply={false} />
        ))}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(itemListJsonLd({
        name: heading,
        url: absoluteUrl(canonical),
        items: itemList,
      }))} />

      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs
          items={[
            { label: isTutors ? 'Find tutors' : 'Find tuitions', href: isTutors ? '/browse/tutors' : '/browse/tuitions' },
            { label: heading },
          ]}
        />

        <header className="space-y-2">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">{heading}</h1>
          <p className="max-w-3xl text-xs leading-relaxed text-gray-600 sm:text-sm">{intro}</p>
        </header>

        {isTutors ? (
          <TutorFilterBar
            values={{ subject: String(masterId), subjectLabel: subjectName, city, area: '', mode: '', gender: '', feeMin: '', feeMax: '', q: '' }}
          />
        ) : (
          <JobFilterBar
            values={{ subject: String(masterId), subjectLabel: subjectName, city, mode: '', budgetMin: '', budgetMax: '', q: '' }}
          />
        )}

        {firstWindow}

        {isTutors ? (
          <MoreLandingTutors params={params} initialCursor={initialCursor} viewer={GUEST} />
        ) : (
          <MoreLandingJobs params={params} initialCursor={initialCursor} />
        )}

        {/* CTAs. No price on either — a public page never signals a paywall. */}
        <section className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
          <div className="space-y-1">
            <p className="text-sm font-black text-tm-navy">Looking for {article(subjectName)} {subjectName} tutor in {city}?</p>
            <p className="text-xs text-gray-500">Post your tuition and let verified tutors come to you.</p>
            <Link
              href="/parent/dashboard/post-job"
              className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
            >
              <Plus aria-hidden size={14} /> Post your tuition
            </Link>
          </div>
          <div className="space-y-1">
            {/* The quiet tutor line — no price, per the conversion rules. */}
            <p className="text-sm font-black text-tm-navy">Teach {subjectName} in {city}?</p>
            <p className="text-xs text-gray-500">
              Join TutorMint and appear here to parents searching for your subject in your area.
            </p>
            <Link
              href="/register"
              className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-green-deep/30 bg-tm-tint-green px-4 text-xs font-bold text-tm-green-deep"
            >
              <UserPlus aria-hidden size={14} /> Join TutorMint
            </Link>
          </div>
        </section>

        {(inCity.length > 0 || inOtherCities.length > 0) && (
          <nav aria-label="Related pages" className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            {inCity.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-black text-tm-navy">More subjects in {city}</p>
                <ul className="flex flex-wrap gap-2">
                  {inCity.map((p) => (
                    <li key={`${p.citySlug}/${p.subjectSlug}`}>
                      <Link
                        href={`/${p.kind}/${p.citySlug}/${p.subjectSlug}`}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
                      >
                        {isTutors ? <GraduationCap aria-hidden size={12} /> : <Briefcase aria-hidden size={12} />}
                        {p.subjectName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inOtherCities.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-black text-tm-navy">{subjectName} in other cities</p>
                <ul className="flex flex-wrap gap-2">
                  {inOtherCities.map((p) => (
                    <li key={`${p.citySlug}/${p.subjectSlug}`}>
                      <Link
                        href={`/${p.kind}/${p.citySlug}/${p.subjectSlug}`}
                        className="inline-flex min-h-[36px] items-center rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
                      >
                        {p.city}
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
