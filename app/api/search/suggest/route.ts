import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { parseQuery, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// GET /api/search/suggest?q=…&city=…
//
// The one search endpoint. Every typeahead on the platform calls it, signed in
// or not, and it is the reason there are no search buttons left.
//
// ANON-SAFE, and that is a property of what it returns rather than of who may
// call it. It returns four kinds of thing — taxonomy entries, place names,
// listed tutors, open jobs — and no contact field of any kind. The listing
// rules are applied inside search_suggest() against tutor_directory and
// jobs.status, so this route cannot widen them by passing a flag.
//
// Called through the SERVICE-ROLE client on purpose. search_suggest() is
// granted to service_role only, so the rate limit below is the single door: if
// EXECUTE were granted to anon, a caller with the publishable key — which is
// in every browser bundle — could hit the function directly through PostgREST
// and the limit would be guarding nothing.

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  // Two characters is the platform minimum. One character matches most of the
  // taxonomy and is not a search, it is a scan.
  q: z.string().trim().max(80).optional().default(''),
  city: z.string().trim().max(60).optional().default(''),
  // The page the search was opened from (PR53 Part B). Subject, city and popular
  // suggestions must land back on the SAME board — the SQL builds them all as
  // `/browse/tutors?…`, so on the tuitions board they are re-pointed to
  // `/browse/tuitions?…`. Defaults to tutors, the shape the SQL already emits.
  for: z.enum(['tutors', 'tuitions']).optional().default('tutors'),
})

export type SuggestGroup = 'subject' | 'location' | 'tutor' | 'job'

export type Suggestion = {
  group: SuggestGroup
  ref: string
  label: string
  sublabel: string
  href: string
}

export type SuggestResponse = {
  query: string
  suggestions: Suggestion[]
  popular: Suggestion[]
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = parseQuery(url, QuerySchema)
  if (!parsed.ok) return parsed.response

  const q = parsed.data.q
  const city = parsed.data.city || null

  // Keep a subject/city/popular suggestion on the board it was opened from
  // (PR53 Part B). The SQL emits every one of these as `/browse/tutors?…`; on
  // the tuitions board we swap that one path prefix, which preserves the
  // ?subject= / ?city= the tuitions page already reads. A job hit
  // (`/browse/tuitions?job=`) and a tutor hit (`/tutor/<slug>`) do not start
  // with `/browse/tutors`, so they are untouched — and each is only ever shown
  // in its own board's group anyway.
  const retarget = (href: string): string =>
    parsed.data.for === 'tuitions' && href.startsWith('/browse/tutors')
      ? '/browse/tuitions' + href.slice('/browse/tutors'.length)
      : href

  const admin = createAdminClient()
  if (!admin) {
    // Honest failure rather than a cheerful empty list: an empty panel is
    // indistinguishable from "nothing matched", and a misconfigured deploy
    // would look like a platform with no tutors on it.
    console.error('[search] service-role client unavailable')
    return NextResponse.json(
      { error: 'Search is unavailable right now. Please try again shortly.' },
      { status: 503 },
    )
  }

  // The empty state. Popular subjects are scoped to the signed-in member's own
  // city when they have one, because "popular" means nothing nationally to a
  // parent in Multan.
  if (q.length < 2) {
    const cityForPopular = city ?? (await viewerCity())
    const [limitedEmpty, popularResult] = await Promise.all([
      rateLimit('search', callerIp(request)),
      admin.rpc('popular_subjects', { p_city: cityForPopular, p_limit: 6 }),
    ])
    if (!limitedEmpty.allowed) {
      return tooManyRequests(limitedEmpty.retryAfterSeconds, 'searches')
    }
    const { data, error } = popularResult
    if (error) {
      console.error('[search] popular_subjects failed:', error.message)
      return NextResponse.json({ query: q, suggestions: [], popular: [] } satisfies SuggestResponse)
    }
    return NextResponse.json({
      query: q,
      suggestions: [],
      popular: (data ?? [])
        .map(toSuggestion('subject'))
        .map((s: Suggestion) => ({ ...s, href: retarget(s.href) })),
    } satisfies SuggestResponse)
  }

  // Rate limit and search run CONCURRENTLY, not in sequence.
  //
  // Both are round trips to Postgres, and a typeahead pays that latency on
  // every debounce -- serialising them doubles the wait for no benefit. It is
  // safe to overlap them here specifically because the limiter FAILS OPEN and
  // this query reads nothing private: the worst case for a caller who has
  // exceeded their budget is that the database did some work whose result is
  // thrown away unread, and they still get the 429.
  //
  // This reasoning does not transfer to a route that writes.
  const [limited, result] = await Promise.all([
    rateLimit('search', callerIp(request)),
    admin.rpc('search_suggest', { p_query: q, p_city: city, p_limit: 5 }),
  ])

  if (!limited.allowed) return tooManyRequests(limited.retryAfterSeconds, 'searches')

  const { data, error } = result

  if (error) {
    console.error('[search] search_suggest failed:', error.message)
    return NextResponse.json(
      { error: 'Search is unavailable right now. Please try again shortly.' },
      { status: 503 },
    )
  }

  type Row = { grp: string; ref: string; label: string; sublabel: string; href: string }
  const mapped: Suggestion[] = ((data ?? []) as Row[]).map((r) => ({
    group: r.grp as SuggestGroup,
    ref: r.ref,
    label: r.label,
    sublabel: r.sublabel,
    href: r.href,
  }))

  const suggestions = withAllLevels(mapped).map((s) => ({ ...s, href: retarget(s.href) }))
  return NextResponse.json(
    { query: q, suggestions, popular: [] } satisfies SuggestResponse,
  )
}

/**
 * Prepend a "<subject> · all levels" entry for the resolved subject (owner PR14
 * §5.1). search_suggest returns the subject's levels in taxonomy order; this
 * puts the aggregate first (it filters across every level via ?q=), then those
 * levels, then everything else. Only when the subject spans more than one level.
 */
function withAllLevels(suggestions: Suggestion[]): Suggestion[] {
  const subjectRows = suggestions.filter((s) => s.group === 'subject')
  if (subjectRows.length === 0) return suggestions
  const topLabel = subjectRows[0].label
  const topLevels = subjectRows.filter((s) => s.label === topLabel)
  if (topLevels.length < 2) return suggestions

  const allLevels: Suggestion = {
    group: 'subject',
    ref: `all:${topLabel}`,
    label: topLabel,
    sublabel: 'all levels',
    // Filters across every level of the subject — the browse resolver expands
    // the query to all master ids for it (owner PR13 §3).
    href: `/browse/tutors?q=${encodeURIComponent(topLabel)}`,
  }
  const rest = suggestions.filter((s) => !(s.group === 'subject' && s.label === topLabel))
  return [allLevels, ...topLevels, ...rest]
}

/**
 * The signed-in member's city, or null.
 *
 * Read through the COOKIE client, not the admin client: this is the one thing
 * here that depends on who is asking, and the session is the only honest
 * source for it. A guest simply gets national popular subjects.
 */
async function viewerCity(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('profiles')
      .select('role, city')
      .eq('id', user.id)
      .maybeSingle()
    // One city field for tutors: a tutor's city is tutor_profiles.city (PR 3b §0.6);
    // everyone else's is profiles.city.
    if ((data?.role as string | null) === 'tutor') {
      const { data: tp } = await supabase
        .from('tutor_profiles')
        .select('city')
        .eq('id', user.id)
        .maybeSingle()
      return (tp?.city as string | null) || null
    }
    return (data?.city as string | null) || null
  } catch {
    return null
  }
}

function toSuggestion(group: SuggestGroup) {
  return (r: { ref: string; label: string; sublabel: string; href: string }): Suggestion => ({
    group,
    ref: r.ref,
    label: r.label,
    sublabel: r.sublabel,
    href: r.href,
  })
}
