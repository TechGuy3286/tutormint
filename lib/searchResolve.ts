import { createAdminClient } from '@/lib/supabase/admin'

// Resolve a free-text browse query to a real subject (owner PR12 §4).
//
// A parent types "fizics" (or a Roman-Urdu spelling like "hisab"), the typeahead
// suggests Physics — but pressing Enter / "Show all results" applied the literal
// text as a title filter, which matched nothing and showed an empty board. This
// turns the committed text into the subject the typeahead itself would suggest,
// so the results are what the reader meant.
//
// It reuses search_suggest() — the SAME fuzzy + Roman-Urdu-alias matcher the
// panel uses, so what Enter resolves to and what the panel shows can never
// diverge. Service-role only, exactly like /api/search/suggest, because
// search_suggest is granted to service_role alone.

export type ResolvedSubject = { masterId: number; label: string }

/**
 * The subject a committed query resolves to, or null when it names no subject
 * (a city, a tutor name, or gibberish — the caller then keeps the literal q).
 * Returns the TOP-ranked subject suggestion, which search_suggest already
 * orders by open-tuition demand then match score.
 */
export async function resolveSubjectQuery(
  q: string,
  city: string | null,
): Promise<ResolvedSubject | null> {
  const term = q.trim()
  if (term.length < 2) return null

  const admin = createAdminClient()
  if (!admin) return null

  const { data, error } = await admin.rpc('search_suggest', {
    p_query: term,
    p_city: city,
    p_limit: 5,
  })
  if (error) return null

  const rows = (data ?? []) as { grp: string; ref: string; label: string }[]
  const subject = rows.find((r) => r.grp === 'subject')
  if (!subject) return null

  const masterId = Number(subject.ref)
  if (!Number.isFinite(masterId) || masterId <= 0) return null
  return { masterId, label: subject.label }
}
