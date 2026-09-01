import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import { getEntitlements } from '@/lib/entitlements'
import { logActivity } from '@/lib/activityLog'
import { browseJobs, type JobFilters } from '@/lib/jobFeed'
import JobCard from '@/components/JobCard'
import AdSlot from '@/components/ads/AdSlot'
import JobFilterBar, { type JobFilterValues } from './JobFilterBar'

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

  return {
    title,
    description,
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
  const mode = one(sp.mode)
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

  const { jobs, total } = await browseJobs(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isTutor = false
  let appliedIds = new Set<string>()

  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'

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
      await logActivity({
        userId: user.id,
        event: 'search_performed',
        targetType: 'browse',
        meta: {
          surface: 'tuitions',
          master_id: subjectId,
          city: city || null,
          mode: mode || null,
          results: total,
        },
      })
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
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">
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
            <p className="text-sm font-black text-[#0F172A]">Nothing matches those filters</p>
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
              Try a wider budget or clear the subject filter. New tuitions are posted every day.
            </p>
            <Link
              href="/browse/tuitions"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white"
            >
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
                />
                {(i + 1) % AD_EVERY === 0 && i + 1 < jobs.length && (
                  <AdSlot audience="tutors" index={Math.floor(i / AD_EVERY)} />
                )}
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Pagination">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#0F172A]"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs font-bold text-gray-500">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link
                href={pageHref(page + 1)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#0F172A]"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </main>
  )
}
