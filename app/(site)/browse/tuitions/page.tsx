import { List, ShieldCheck } from 'lucide-react'
import Breadcrumbs from '@/components/Breadcrumbs'
import { parseMode } from '@/lib/locations'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import { getEntitlements } from '@/lib/entitlements'
import { cookies } from 'next/headers'
import { logSearchPerformed } from '@/lib/activityLog'
import { logAnonSearch } from '@/lib/anonSearch'
import { ANON_COOKIE, isAnonId } from '@/lib/anonSession'
import { browseJobs, type JobFilters, type TutorScope } from '@/lib/jobFeed'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import { resolveSubjectQuery } from '@/lib/searchResolve'
import JobCard from '@/components/JobCard'
import AdSlot from '@/components/ads/AdSlot'
import JobFilterBar, { type JobFilterValues } from './JobFilterBar'
import MoreJobs from './MoreJobs'
import PopularLandingLinks from '@/components/landing/PopularLandingLinks'

// /browse/tuitions -- the other half of the organic-search surface.
//
// Server component, results in the HTML, same SEO rule as /browse/tutors. The
// ranking rule is the whole of the jobs spec: featured jobs first, then newest.
//
// Apply is shown to guests (who get the sign-in modal) and to tutors. It is
// hidden from parents, who have no use for it, and every gate behind it is
// re-checked in /api/applications regardless of what rendered here.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 12
const AD_EVERY = 8

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? ''
}

function intOrNull(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** Display label for a taxonomy_master id. Uses the cacheable anon client. */
async function subjectLabel(masterId: number | null): Promise<string | null> {
  if (!masterId) return null
  const supabase = createPublicClient()

  const { data } = await supabase
    .from('taxonomy_master')
    .select('level_slug, subject_slug')
    .eq('id', masterId)
    .maybeSingle()
  if (!data) return null

  const [level, subject] = await Promise.all([
    supabase.from('taxonomy_levels').select('name').eq('slug', data.level_slug).maybeSingle(),
    data.subject_slug
      ? supabase.from('taxonomy_subjects').select('name').eq('slug', data.subject_slug).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const levelName = level.data?.name ?? null
  const subjectName = (subject.data as { name?: string } | null)?.name ?? null
  if (subjectName && levelName) return `${levelName} ${subjectName}`
  return subjectName ?? levelName
}

/**
 * rel=prev / rel=next for the ?page=N series.
 *
 * The list scrolls for a person, but a crawler does not scroll: without these
 * links the only page of the directory it can ever reach is the first one, and
 * every job past position 12 would be invisible to search. Next emits them
 * from `metadata.pagination`.
 *
 * Built from the live searchParams so a filter added later is carried into the
 * series automatically — a rel=next that silently dropped ?city= would point
 * the crawler at a different list from the one it is reading.
 */
function paginationLinks(
  base: string,
  sp: Record<string, string | string[] | undefined>,
  page: number,
  hasNext: boolean,
) {
  const href = (n: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (k === 'page') continue
      const first = Array.isArray(v) ? v[0] : v
      if (first) params.set(k, first)
    }
    if (n > 1) params.set('page', String(n))
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }

  return {
    previous: page > 1 ? href(page - 1) : undefined,
    next: hasNext ? href(page + 1) : undefined,
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  const sp = await searchParams
  const city = one(sp.city)
  const label = await subjectLabel(intOrNull(one(sp.subject)))

  const what = label ? `${label} tuition jobs` : 'Home tuition jobs'
  const where = city ? ` in ${city}` : ' in Pakistan'
  const title = `${what}${where} | TutorMint`
  const description = label
    ? `Open ${label} tuition jobs${where} posted by verified parents. Free to browse and apply on TutorMint.`
    : `Open home and online tuition jobs${where} posted by verified parents. Free to browse and apply on TutorMint.`

  const page = Math.max(1, intOrNull(one(sp.page)) ?? 1)
  // Identical arguments to the page body's own call is not possible here --
  // browseJobs is not memoised -- so this asks for a single row and reads the
  // exact count off it, which is the cheapest way to know whether a next page
  // exists.
  const { total } = await browseJobs(
    {
      masterId: intOrNull(one(sp.subject)),
      city: one(sp.city) || null,
      mode: parseMode(one(sp.mode)),
      budgetMin: intOrNull(one(sp.budgetMin)),
      budgetMax: intOrNull(one(sp.budgetMax)),
      q: one(sp.q) || null,
    },
    1,
  )

  return {
    title,
    description,
    pagination: paginationLinks('/browse/tuitions', sp, page, page * 12 < total),
    alternates: {
      canonical: city ? `/browse/tuitions?city=${encodeURIComponent(city)}` : '/browse/tuitions',
    },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function BrowseTuitionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams

  const subjectId = intOrNull(one(sp.subject))
  const city = one(sp.city)
  const mode = parseMode(one(sp.mode)) ?? ''
  const budgetMin = one(sp.budgetMin)
  const budgetMax = one(sp.budgetMax)
  const q = one(sp.q)
  const page = Math.max(1, intOrNull(one(sp.page)) ?? 1)

  // §4.1/§3: a committed free-text query (a misspelling or a Roman-Urdu
  // spelling) resolves to the subject the typeahead would suggest, ACROSS EVERY
  // LEVEL of it (or to one level when the query names one), and we filter by
  // those masters rather than a literal title match that finds nothing. Only
  // when no explicit subject is already chosen.
  let resolvedLabel: string | null = null
  let resolvedMasterIds: number[] | null = null
  if (!subjectId && q) {
    const resolved = await resolveSubjectQuery(q, city || null)
    if (resolved) {
      resolvedMasterIds = resolved.masterIds
      resolvedLabel = resolved.label
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isTutor = false
  let viewerCity: string | null = null
  let viewerJobTypes: readonly string[] | null = null
  let viewerRole: string | null = null
  let viewerPlan: string | null = null
  let tutorUnverified = false
  let appliedIds = new Set<string>()
  let savedIds = new Set<string>()
  // PR71: the tutor's own city+areas default, resolved BEFORE the query so the
  // first window is scoped. Applied only on a bare location URL (no ?city and no
  // ?scope=all), so removing it (the chip's widen links) is honoured — and never
  // for a guest or a parent, who see the whole board exactly as before.
  const wantsAll = one(sp.scope) === 'all'
  let tutorScope: TutorScope | null = null

  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'
    viewerRole = ent.role
    viewerPlan = ent.plan
    // An unverified tutor has paid no fee, so holds no plan (Basic is synthesised
    // from the fee). Only this viewer sees the verify prompt (owner PR2 §1.3).
    tutorUnverified = isTutor && !ent.plan

    // Job Type + city, to align matches and decide the "Suitable for online"
    // chip on a cross-city online job.
    if (isTutor) {
      const [{ data: tp }, { data: areaRows }] = await Promise.all([
        supabase.from('tutor_profiles').select('city, teaching_mode, job_types').eq('id', user.id).maybeSingle(),
        supabase.from('tutor_areas').select('area').eq('tutor_id', user.id),
      ])
      viewerCity = (tp?.city as string | null) ?? null
      viewerJobTypes = (tp?.job_types as string[] | null) ?? null
      const tutorCity = (viewerCity ?? '').trim()
      const areas = [...new Set(((areaRows ?? []).map((r) => ((r.area as string) ?? '').trim()).filter(Boolean)))]
      if (tutorCity && areas.length > 0) {
        tutorScope = { city: tutorCity, areas, includeOnline: (viewerJobTypes ?? []).includes(ONLINE_JOB_TITLE) }
      }
    }
  }

  // Apply the default only when the tutor did not choose a location (no ?city)
  // and did not widen to all cities (?scope=all).
  const defaultApplied = !!tutorScope && !city && !wantsAll

  const filters: JobFilters = {
    masterId: subjectId,
    masterIds: resolvedMasterIds,
    city: city || null,
    mode: mode || null,
    budgetMin: intOrNull(budgetMin),
    budgetMax: intOrNull(budgetMax),
    // When the query resolved to subject(s), the literal title filter is dropped
    // (it would AND with the subject and empty the board again).
    q: resolvedLabel ? null : q || null,
    tutorScope: defaultApplied ? tutorScope : null,
  }

  // The first window is server-rendered — this page is an organic-search
  // surface and ?page=N must keep resolving for crawlers and shared links.
  // Everything below it is appended by MoreJobs from a keyset cursor.
  const { jobs, total, nextCursor } = await browseJobs(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (user) {
    if (isTutor && jobs.length > 0) {
      const { data: mine } = await supabase
        .from('applications')
        .select('job_id')
        .eq('tutor_id', user.id)
        .in('job_id', jobs.map((j) => j.id))
      appliedIds = new Set((mine ?? []).map((a) => a.job_id as string))

      const { data: savedRows } = await supabase
        .from('saved_jobs')
        .select('job_id')
        .eq('user_id', user.id)
        .in('job_id', jobs.map((j) => j.id))
      savedIds = new Set((savedRows ?? []).map((s) => s.job_id as string))
    }

    const filtered = !!(subjectId || city || mode || budgetMin || budgetMax || q)
    if (filtered) {
      // Collapsed for the typeahead -- see logSearchPerformed().
      await logSearchPerformed({
        userId: user.id,
        surface: 'tuitions',
        filters: {
          master_id: subjectId,
          city: city || null,
          mode: mode || null,
        },
        results: total,
      })
    }
  } else {
    // Anonymous demand — most of the traffic. Session-scoped, no PII, never on
    // a member timeline. See lib/anonSearch.ts.
    const filtered = !!(subjectId || city || mode || budgetMin || budgetMax || q)
    if (filtered) {
      const sessionId = (await cookies()).get(ANON_COOKIE)?.value
      if (isAnonId(sessionId)) {
        await logAnonSearch({
          sessionId,
          surface: 'tuitions',
          filters: { master_id: subjectId, city: city || null, mode: mode || null },
          results: total,
        })
      }
    }
  }

  // Guests see Apply too -- pressing it is what opens the sign-in modal, which
  // is the whole point of the "feels free" rule.
  const showApply = !user || isTutor

  const label = await subjectLabel(subjectId)
  const heading = label ? `${label} tuitions` : 'Open tuitions'

  const filterValues: JobFilterValues = {
    subject: subjectId ? String(subjectId) : '',
    subjectLabel: label,
    city,
    mode,
    budgetMin,
    budgetMax,
    q,
    scope: wantsAll ? 'all' : '',
  }

  // The two "widen" links on the default-areas chip (PR71), preserving every
  // NON-location filter so removing the area default keeps the subject/budget/etc.
  const widenHref = (override: Record<string, string>) => {
    const p = new URLSearchParams()
    if (filterValues.subject) p.set('subject', filterValues.subject)
    if (mode) p.set('mode', mode)
    if (budgetMin) p.set('budgetMin', budgetMin)
    if (budgetMax) p.set('budgetMax', budgetMax)
    if (q) p.set('q', q)
    for (const [k, v] of Object.entries(override)) p.set(k, v)
    return `/browse/tuitions?${p}`
  }
  const cityWidenHref = defaultApplied ? widenHref({ city: tutorScope!.city }) : '#'
  const allCitiesHref = defaultApplied ? widenHref({ scope: 'all' }) : '#'

  const pageHref = (n: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries({
      subject: filterValues.subject,
      city,
      mode,
      budgetMin,
      budgetMax,
      q,
    })) {
      if (v) params.set(k, v)
    }
    if (n > 1) params.set('page', String(n))
    return params.toString() ? `/browse/tuitions?${params}` : '/browse/tuitions'
  }

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-4 text-slate-700 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs items={[{ label: 'Find tuitions' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">
            {heading}
            {city ? ` in ${city}` : ''}
          </h1>
          <p className="text-xs text-gray-500">
            {total === 0
              ? 'No open tuitions match these filters yet.'
              : `${total} open tuition${total === 1 ? '' : 's'} · free to browse, no account needed`}
          </p>
          {/* §4.1: when a misspelled/Roman-Urdu query resolved to a subject. */}
          {resolvedLabel && (
            <p className="text-xs font-bold text-tm-navy">
              Showing results for &ldquo;{resolvedLabel}&rdquo;
            </p>
          )}
        </header>

        {/* The verify prompt — shown ONLY to a logged-in tutor who has not paid
            the one-time fee (owner PR2 §1.3). Not an ad row and not the ad slot:
            a targeted, price-free prompt hidden from guests, parents, admins and
            verified tutors. Replaces the stale "Get found" strip, which was never
            in the codebase or the advertisements table. */}
        {tutorUnverified && (
          <section className="flex flex-col gap-2 rounded-2xl border border-tm-green-deep/20 bg-tm-tint-green p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold text-tm-navy">
                Verified tutors can apply to tuitions and contact parents directly.
              </p>
              {/* Urdu line (PR59), same font stack as the Membership Plans box. */}
              <p
                lang="ur"
                dir="rtl"
                className="text-right text-xs font-semibold leading-loose text-tm-navy"
                style={{
                  fontFamily:
                    "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Nafees Nastaleeq', 'Urdu Typesetting', 'Segoe UI', system-ui, sans-serif",
                }}
              >
                تصدیق شدہ ٹیوٹرز ٹیوشنز کے لیے اپلائی کر سکتے ہیں اور والدین سے براہ راست رابطہ کر سکتے ہیں۔
              </p>
            </div>
            <Link
              href="/tutor/complete-profile?step=verify"
              className="gap-1.5 inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
            >
              <ShieldCheck aria-hidden size={14} />
              Verify
            </Link>
          </section>
        )}

        <JobFilterBar values={filterValues} />

        {/* PR71: the tutor's own city+areas default, as a removable chip. Only a
            signed-in tutor with a city and areas sees it; guests and parents do
            not. English with Urdu underneath. */}
        {defaultApplied && tutorScope && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-tm-navy/15 bg-tm-tint-navy px-3 py-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-tm-navy">
              <span>
                Your areas: {tutorScope.areas.join(', ')}
                <span lang="ur" dir="rtl" className="ms-1 font-medium text-gray-500">آپ کے علاقے</span>
              </span>
              <Link href={allCitiesHref} aria-label="Remove your-areas filter and show all cities" className="grid h-5 w-5 place-items-center rounded-full text-tm-navy hover:bg-tm-tint-navy">✕</Link>
            </span>
            <Link href={cityWidenHref} className="inline-flex min-h-[36px] items-center rounded-full border border-tm-navy/30 bg-white px-3 text-xs font-bold text-tm-navy hover:border-tm-navy">
              All areas in {tutorScope.city}
              <span lang="ur" dir="rtl" className="ms-1 font-medium text-gray-500">{tutorScope.city} کے تمام علاقے</span>
            </Link>
            <Link href={allCitiesHref} className="inline-flex min-h-[36px] items-center rounded-full border border-tm-navy/30 bg-white px-3 text-xs font-bold text-tm-navy hover:border-tm-navy">
              All cities
              <span lang="ur" dir="rtl" className="ms-1 font-medium text-gray-500">تمام شہر</span>
            </Link>
          </div>
        )}

        {/* A tutor with no city/areas yet sees the whole board (as now) with a
            short prompt to add their area so this list can be narrowed (PR71 §1). */}
        {isTutor && !tutorScope && !city && !wantsAll && (
          <p className="rounded-xl border border-tm-navy/15 bg-tm-tint-navy px-3 py-2.5 text-xs text-tm-navy">
            Add your city and areas in{' '}
            <Link href="/tutor/dashboard/settings" className="font-bold underline">Settings</Link>{' '}
            to see tuitions near you.
            <span lang="ur" dir="rtl" className="ms-1 text-gray-500">اپنے قریب ٹیوشنز دیکھنے کے لیے سیٹنگز میں اپنا شہر اور علاقے شامل کریں۔</span>
          </p>
        )}

        {jobs.length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-black text-tm-navy">Nothing matches those filters</p>
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
              Try a wider budget or clear the subject filter. New tuitions are posted every day.
            </p>
            <Link
              href="/browse/tuitions"
              className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white"
            >
              <List aria-hidden size={14} />
              Show all tuitions
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job, i) => (
              <div key={job.id} className="space-y-4">
                <JobCard
                  job={job}
                  signedIn={!!user}
                  showApply={showApply}
                  applied={appliedIds.has(job.id)}
                  viewerCity={viewerCity}
                  viewerJobTypes={viewerJobTypes}
                  saveable={isTutor}
                  initiallySaved={savedIds.has(job.id)}
                />
                {(i + 1) % AD_EVERY === 0 && (
                  <AdSlot
                    slot="browse-inline"
                    audience="tutors"
                    index={Math.floor(i / AD_EVERY)}
                    viewerRole={viewerRole}
                    viewerPlan={viewerPlan}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* No numbered pagination (CLAUDE.md, 3 Sep 2026). */}
        {jobs.length > 0 && (
          <MoreJobs
            params={{ ...jobParams(sp), ...(defaultApplied ? { scope: 'mine' } : {}), ...(page > 1 ? { page: String(page) } : {}) }}
            initialCursor={nextCursor}
            total={total}
            serverCount={(page - 1) * PAGE_SIZE + jobs.length}
            signedIn={!!user}
            showApply={showApply}
            adEvery={AD_EVERY}
            viewerCity={viewerCity}
            viewerJobTypes={viewerJobTypes}
            saveable={isTutor}
            savedIds={Array.from(savedIds)}
          />
        )}

        {/* Internal links to the city × subject landing pages (PR43 §2), so they
            are not orphans. Only shows the ones that exist (>= threshold). */}
        <PopularLandingLinks kind="tuitions" />
      </div>
    </main>
  )
}

/**
 * The filters, straight off the live searchParams.
 *
 * Read from `sp` rather than rebuilt from the parsed values so a filter added
 * later is carried into load-more without anybody having to remember this
 * function exists — the failure mode being a second window that quietly
 * ignores the city the reader searched for.
 */
function jobParams(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['subject', 'city', 'mode', 'budgetMin', 'budgetMax', 'q']) {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k]
    if (v) out[k] = v
  }
  return out
}
