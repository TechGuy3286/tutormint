// lib/anonSearch.ts
//
// Anonymous, session-scoped search telemetry.
//
// The member path (lib/activityLog.ts logSearchPerformed) needs a user id and
// writes to the timeline. Guests have neither, and most browsing on a "feels
// free" site is by guests — so without this the content queue's demand signal
// only ever sees the signed-in minority. These rows go to anon_search_events,
// a separate table that is NOT the member timeline, so "never shows on a
// member timeline" holds by construction.
//
// Same collapse as the member path: a typeahead re-renders the browse page on
// every debounced keystroke, and the free-text query is never in the payload,
// so consecutive renders with the same filter set are one search, not seven.
//
// Rate-limited on the session id: a scraper walking the board must not be able
// to write our demand signal for us. Fails open (a wobble should not cost the
// signal); writes through the service-role client.

import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'

export async function logAnonSearch(params: {
  sessionId: string
  surface: string
  filters: { master_id?: number | null; city?: string | null; area?: string | null; mode?: string | null; gender?: string | null }
  results: number
  withinSeconds?: number
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  // One bucket per session. Generous — a real visitor refining a search
  // genuinely produces a handful a minute after the collapse; this stops a
  // script, not a person.
  const gate = await rateLimit('anon_search', params.sessionId)
  if (!gate.allowed) return

  const since = new Date(Date.now() - (params.withinSeconds ?? 60) * 1000).toISOString()

  try {
    const { data } = await admin
      .from('anon_search_events')
      .select('surface, master_id, city, area, mode, gender')
      .eq('session_id', params.sessionId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)

    const prev = data?.[0] as Record<string, unknown> | undefined
    if (prev) {
      const same =
        prev.surface === params.surface &&
        (prev.master_id ?? null) === (params.filters.master_id ?? null) &&
        (prev.city ?? null) === (params.filters.city ?? null) &&
        (prev.area ?? null) === (params.filters.area ?? null) &&
        (prev.mode ?? null) === (params.filters.mode ?? null) &&
        (prev.gender ?? null) === (params.filters.gender ?? null)
      if (same) return
    }
  } catch {
    // A failed lookup must not cost the event; logging twice beats not logging.
  }

  await admin.from('anon_search_events').insert({
    session_id: params.sessionId,
    surface: params.surface,
    master_id: params.filters.master_id ?? null,
    city: params.filters.city ?? null,
    area: params.filters.area ?? null,
    mode: params.filters.mode ?? null,
    gender: params.filters.gender ?? null,
    results: params.results,
  })
}
