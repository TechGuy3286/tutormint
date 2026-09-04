import { List } from 'lucide-react'
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
import { browseJobs, type JobFilters } from '@/lib/jobFeed'
import JobCard from '@/components/JobCard'
import AdSlot from '@/components/ads/AdSlot'
import JobFilterBar, { type JobFilterValues } from './JobFilterBar'
import MoreJobs from './MoreJobs'

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

  const filters: JobFilters = {
    masterId: subjectId,
    city: city || null,
    mode: mode || null,
    budgetMin: intOrNull(budgetMin),
    budgetMax: intOrNull(budgetMax),
    q: q || null,
  }

  // The first window is server-rendered — this page is an organic-search
  // surface and ?page=N must keep resolving for crawlers and shared links.
  // Everything below it is appended by MoreJobs from a keyset cursor.
  const { jobs, total, nextCursor } = await browseJobs(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isTutor = false
  let viewerCity: string | null = null
  let appliedIds = new Set<string>()

  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'

    // Only to decide the "Suitable for online" chip on cross-city online jobs.
    if (isTutor) {
      const { data: tp } = await supabase.from('tutor_profiles').select('city').eq('id', user.id).maybeSingle()
      viewerCity = (tp?.city as string | null) ?? null
    }

    if (isTutor && jobs.length > 0) {
      const { data: mine } = await supabase
        .from('applications')
        .select('job_id')
        .eq('tutor_id', user.id)
        .in('job_id', jobs.map((j) => j.id))
      appliedIds = new Set((mine ?? []).map((a) => a.job_id as string))
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
  }

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
        </header>

        <JobFilterBar values={filterValues} />

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
                />
                {(i + 1) % AD_EVERY === 0 && (
                  <AdSlot
                    slot="browse-inline"
                    audience="tutors"
                    index={Math.floor(i / AD_EVERY)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* No numbered pagination (CLAUDE.md, 3 Sep 2026). */}
        {jobs.length > 0 && (
          <MoreJobs
            params={{ ...jobParams(sp), ...(page > 1 ? { page: String(page) } : {}) }}
            initialCursor={nextCursor}
            total={total}
            serverCount={(page - 1) * PAGE_SIZE + jobs.length}
            signedIn={!!user}
            showApply={showApply}
            adEvery={AD_EVERY}
            viewerCity={viewerCity}
          />
        )}
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
