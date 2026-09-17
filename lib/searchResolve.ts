import { createAdminClient } from '@/lib/supabase/admin'
import { levelLabel } from '@/lib/display'

// Resolve a free-text browse query to real subject(s) (owner PR12 §4 / PR13 §3).
//
// A parent types "fizics" (or a Roman-Urdu spelling like "hisab"); the typeahead
// suggests Physics / Mathematics, but pressing Enter / "Show all results" applied
// the literal text as a title filter that matched nothing. This turns the
// committed text into the subject the typeahead would suggest and filters by it.
//
// ACROSS EVERY LEVEL (PR13 §3.1). "hisab" → Mathematics returns the master ids
// for Mathematics at EVERY (non-legacy) level, not just the top-ranked one, so a
// Grade-8 Maths tuition and an O-Level Maths tuition both show. UNLESS the query
// also names a level (PR13 §3.2): "o level physics" scopes to O-Level Physics
// only.
//
// It reuses search_suggest() — the SAME fuzzy + Roman-Urdu-alias matcher the
// panel uses — to find the subject, then expands to that subject's levels from
// the taxonomy. Service-role only, like /api/search/suggest.

export type ResolvedSubject = { masterIds: number[]; label: string; levelScoped: boolean }

// Compare words trailing-'s'-insensitively, so "o level" matches "O Levels".
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.endsWith('s') ? w.slice(0, -1) : w))
}

/** True when the query names this level — every word of the level name is present
 *  in the query (so "o level physics" names "O Levels"; "hisab" names none). */
function queryNamesLevel(query: string, levelName: string): boolean {
  const qw = new Set(words(query))
  const lw = words(levelName)
  return lw.length > 0 && lw.every((w) => qw.has(w))
}

export async function resolveSubjectQuery(
  q: string,
  city: string | null,
): Promise<ResolvedSubject | null> {
  const term = q.trim()
  if (term.length < 2) return null

  const admin = createAdminClient()
  if (!admin) return null

  const { data, error } = await admin.rpc('search_suggest', { p_query: term, p_city: city, p_limit: 5 })
  if (error) return null
  const rows = (data ?? []) as { grp: string; ref: string; label: string }[]
  const top = rows.find((r) => r.grp === 'subject')
  if (!top) return null
  const topMasterId = Number(top.ref)
  if (!Number.isFinite(topMasterId) || topMasterId <= 0) return null
  const subjectName = top.label

  // The subject_slug behind the top match, then every non-legacy master that
  // shares it — the subject at all its levels.
  const { data: topM } = await admin
    .from('taxonomy_master')
    .select('subject_slug')
    .eq('id', topMasterId)
    .maybeSingle()
  const subjectSlug = (topM?.subject_slug as string | null) ?? null
  if (!subjectSlug) {
    // A level-leaf (no subject of its own) — the single master is the answer.
    return { masterIds: [topMasterId], label: subjectName, levelScoped: false }
  }

  const { data: masters } = await admin
    .from('taxonomy_master')
    .select('id, level_slug')
    .eq('subject_slug', subjectSlug)
  const levelSlugs = [...new Set((masters ?? []).map((m) => m.level_slug as string))]
  const { data: levels } = await admin
    .from('taxonomy_levels')
    .select('slug, name, legacy')
    .in('slug', levelSlugs.length ? levelSlugs : ['x'])
  const levelBy = new Map((levels ?? []).map((l) => [l.slug as string, l]))

  const candidates = (masters ?? [])
    .map((m) => {
      const lv = levelBy.get(m.level_slug as string)
      return { id: m.id as number, levelName: (lv?.name as string) ?? '', legacy: !!lv?.legacy }
    })
    .filter((c) => c.levelName && !c.legacy)

  if (candidates.length === 0) {
    return { masterIds: [topMasterId], label: subjectName, levelScoped: false }
  }

  // §3.2: the query names a level → scope to it only.
  const named = candidates.filter((c) => queryNamesLevel(term, c.levelName))
  if (named.length > 0) {
    const label =
      named.length === 1 ? `${levelLabel(named[0].levelName)} ${subjectName}` : subjectName
    return { masterIds: named.map((c) => c.id), label, levelScoped: true }
  }

  // §3.1: no level named → every level of the subject.
  return { masterIds: candidates.map((c) => c.id), label: subjectName, levelScoped: false }
}
