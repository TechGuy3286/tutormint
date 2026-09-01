import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { logActivity } from '@/lib/activityLog'
import TutorCard, { type TutorCardData, type CardViewer } from '@/components/TutorCard'
import AdSlot from '@/components/ads/AdSlot'
import TutorFilterBar, { type FilterValues } from './TutorFilterBar'

// /browse/tutors -- a server component, on purpose.
//
// This page and /tutor/[slug] are the platform's organic-search surface.
// CLAUDE.md: results must be present in the HTML, and a client-side
// "Loading directory..." fetch is not acceptable. Everything below is
// rendered on the server; the only client code on the page is the filter bar,
// the shortlist/demo buttons and the sign-in modal.
//
// Ranking is not done here either. rank_tutors() in the database applies the
// whole algorithm -- tier, then location, then Bayesian rating, then the daily
// rotation -- and this page renders the rows in the order it got them.

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

/** Display label for a taxonomy_master id, for headings and <title>. */
async function subjectLabel(masterId: number | null): Promise<string | null> {
  if (!masterId) return null
  const supabase = await createClient()
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

  const what = label ? `${label} tutors` : 'Verified tutors'
  const where = city ? ` in ${city}` : ' in Pakistan'
  const title = `${what}${where} | TutorMint`
  const description = label
    ? `Browse verified ${label} tutors${where}. Real profiles, verified identity, video introductions. Free to browse on TutorMint.`
    : `Browse verified home and online tutors${where}. Real profiles, verified identity, video introductions. Free to browse on TutorMint.`

  return {
    title,
    description,
    alternates: { canonical: city ? `/browse/tutors?city=${encodeURIComponent(city)}` : '/browse/tutors' },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function BrowseTutorsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams

  const subjectId = intOrNull(one(sp.subject))
  const city = one(sp.city)
  const area = one(sp.area)
  const mode = one(sp.mode)
  const gender = one(sp.gender)
  const feeMin = one(sp.feeMin)
  const feeMax = one(sp.feeMax)
  const q = one(sp.q)
  const page = Math.max(1, intOrNull(one(sp.page)) ?? 1)

  /**
   * The current search with some filters dropped.
   *
   * Built from the live searchParams rather than assembled from the parsed
   * values, so a filter added later is carried across without anybody having
   * to remember to add it here — the failure mode being a "search the whole
   * city" link that silently discards the subject the parent came for.
   */
  const widen = (drop: Record<string, undefined>) => {
    const next = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (k in drop || k === 'page') continue
      const one = Array.isArray(v) ? v[0] : v
      if (one) next.set(k, one)
    }
    const qs = next.toString()
    return qs ? `/browse/tutors?${qs}` : '/browse/tutors'
  }

  const supabase = await createClient()

  const { data: rows, error } = await supabase.rpc('rank_tutors', {
    p_master_id: subjectId,
    p_city: city || null,
    p_area: area || null,
    p_teaching_mode: mode || null,
    p_gender: gender || null,
    p_fee_min: intOrNull(feeMin),
    p_fee_max: intOrNull(feeMax),
    p_query: q || null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })

  const tutors = (rows ?? []) as (TutorCardData & { total_count: number })[]
  const total = tutors[0]?.total_count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Who is looking. Guests get the full page -- browsing never asks for an
  // account -- and only the transactional buttons behave differently.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let viewer: CardViewer = {
    signedIn: false,
    role: null,
    verifiedParent: false,
    canInitiateMessage: false,
  }
  let saved = new Set<string>()

  if (user) {
    const ent = await getEntitlements(user.id)
    viewer = {
      signedIn: true,
      role: ent.role,
      verifiedParent: ent.audience === 'parent' && !!ent.plan,
      canInitiateMessage: ent.canInitiateMessage,
    }

    const { data: shortlisted } = await supabase.from('shortlists').select('tutor_id')
    saved = new Set((shortlisted ?? []).map((s) => s.tutor_id as string))

    // Instrumentation: what was searched, never who it was for beyond the
    // member's own timeline. No free-text query is stored.
    const filtered = !!(subjectId || city || area || mode || gender || feeMin || feeMax || q)
    if (filtered) {
      await logActivity({
        userId: user.id,
        event: 'search_performed',
        targetType: 'browse',
        meta: {
          surface: 'tutors',
          master_id: subjectId,
          city: city || null,
          area: area || null,
          mode: mode || null,
          gender: gender || null,
          results: total,
        },
      })
    }
  }

  const label = await subjectLabel(subjectId)
  const heading = label ? `${label} tutors` : 'Verified tutors'

  const filters: FilterValues = {
    subject: subjectId ? String(subjectId) : '',
    subjectLabel: label,
    city,
    area,
    mode,
    gender,
    feeMin,
    feeMax,
    q,
  }

  const pageHref = (n: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries({ subject: filters.subject, city, area, mode, gender, feeMin, feeMax, q })) {
      if (v) params.set(k, v)
    }
    if (n > 1) params.set('page', String(n))
    return params.toString() ? `/browse/tutors?${params}` : '/browse/tutors'
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
              ? 'No tutors match these filters yet.'
              : `${total} tutor${total === 1 ? '' : 's'} · free to browse, no account needed`}
          </p>
        </header>

        <TutorFilterBar values={filters} />

        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-[#d60008]">
            The directory could not be loaded. Please try again.
          </p>
        )}

        {tutors.length === 0 && !error ? (
          /*
            A no-results screen with three specific ways forward rather than
            one "clear filters" button. The filters that most often produce an
            empty page are area and teaching mode, so those get their own
            escape hatch: widening to the whole city, and including tutors who
            teach online, are usually the two changes that would have found
            somebody. The third is the honest one -- there may genuinely be
            nobody, and in that case posting the tuition makes tutors come to
            them instead.
          */
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 text-center sm:p-8">
            <div className="space-y-1.5">
              <p className="text-sm font-black text-[#0F172A]">No tutors match that yet</p>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
                {area && city
                  ? `Nobody in ${area} matches. There may well be someone nearby.`
                  : 'Try one of these — the last one works even when nobody is listed yet.'}
              </p>
            </div>

            <div className="mx-auto flex max-w-sm flex-col gap-2">
              {area && (
                <Link
                  href={widen({ area: undefined })}
                  className="flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#0F172A] transition-colors hover:border-[#0F172A]"
                >
                  Search all of {city || 'the city'}
                </Link>
              )}
              {mode !== 'Online' && (
                <Link
                  href={widen({ mode: undefined, area: undefined })}
                  className="flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#0F172A] transition-colors hover:border-[#0F172A]"
                >
                  Include tutors who teach online
                </Link>
              )}
              <Link
                href="/parent/dashboard/post-job"
                className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#d60008] px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-red-700"
              >
                Post your tuition instead
              </Link>
              <Link
                href="/browse/tutors"
                className="flex min-h-[44px] items-center justify-center text-xs font-bold text-gray-500 hover:text-[#0F172A]"
              >
                Clear every filter
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {tutors.map((t, i) => (
              <div key={t.id} className="space-y-4">
                <TutorCard
                  tutor={t}
                  viewer={viewer}
                  initiallySaved={saved.has(t.id)}
                  showMessage={!viewer.signedIn || viewer.role !== 'tutor'}
                />
                {/* One inline slot after every 8 results, never inside the
                    ranking itself. */}
                {(i + 1) % AD_EVERY === 0 && i + 1 < tutors.length && (
                  <AdSlot
                    slot="browse-inline"
                    audience="parents"
                    index={Math.floor(i / AD_EVERY)}
                    viewerRole={viewer.role ?? null}
                  />
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
