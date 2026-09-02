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
      popular: (data ?? []).map(toSuggestion('subject')),
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
  const suggestions: Suggestion[] = ((data ?? []) as Row[]).map((r) => ({
    group: r.grp as SuggestGroup,
    ref: r.ref,
    label: r.label,
    sublabel: r.sublabel,
    href: r.href,
  }))

  return NextResponse.json({ query: q, suggestions, popular: [] } satisfies SuggestResponse)
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
    const { data } = await supabase.from('profiles').select('city').eq('id', user.id).maybeSingle()
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
