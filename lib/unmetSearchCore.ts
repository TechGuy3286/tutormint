// lib/unmetSearchCore.ts
//
// Admin → Overview → "Unmet searches this week" (owner, 11 Oct 2026) — the PURE
// half: which searches count, how they merge into cards, what "done" means, and
// the hiring-post text. No I/O (scripts/test-unmet-searches.ts).
//
//   • Searches by staff, by test accounts, and obvious test strings are left
//     out; the page shows how many were.
//   • Identical searches (ignoring case and spacing) are ONE card with a total.
//   • "Mark done" moves a card to Done. The same search made again LATER is
//     newer than the done time, so it makes a new card.

import { waSendHref } from '@/lib/waLinkCore'

export type UnmetRow = {
  id: number
  query: string
  surface: string
  city: string | null
  subject: string | null
  level: string | null
  school: string | null
  /** profiles.role of the searcher: tutor | parent | admin | null (a guest). */
  role: string | null
  /** A test, seed or hidden account at the time (rows before migration 163: null). */
  is_test?: boolean | null
  created_at: string
}

export type DoneRow = {
  id: string
  query_key: string
  query: string
  searches: number
  note: string | null
  done_by_name: string | null
  done_by_email: string | null
  done_at: string
}

export type UnmetCard = {
  key: string
  query: string
  count: number
  city: string | null
  subject: string | null
  level: string | null
  school: string | null
  surfaces: string[]
  roles: string[]
  last: string
  /** The school this search names, when it names one (owner, 13 Oct 2026):
   *  the card is labelled "School" and offers "Link to school" instead of
   *  "Add as new subject". `href` is null when the school has no page yet. */
  schoolMatch?: { name: string; href: string | null } | null
}

/** Two searches are the same when they match ignoring case and spacing. */
export const searchKey = (q: string | null | undefined) => (q ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Text that marks a search as somebody testing the site. */
export const TEST_STRINGS = ['smoke test', 'smoketest', 'test hidden'] as const

export type ExcludeReason = 'staff' | 'test_account' | 'test_text'

/** Why a search is left out, or null when it counts. */
export function excludeReason(row: Pick<UnmetRow, 'query' | 'role' | 'is_test'>): ExcludeReason | null {
  if (row.role === 'admin') return 'staff'
  if (row.is_test) return 'test_account'
  const k = searchKey(row.query)
  if (TEST_STRINGS.some((t) => k.includes(t))) return 'test_text'
  return null
}

export type UnmetBoard = {
  toReview: UnmetCard[]
  /** Searches left out (staff, test accounts, test text). */
  excluded: number
}

/**
 * The To review cards. A search counts when it is not excluded and is NEWER than
 * the last time the same search was marked done.
 */
export function buildUnmet(rows: UnmetRow[], done: Pick<DoneRow, 'query_key' | 'done_at'>[]): UnmetBoard {
  const lastDone = new Map<string, string>()
  for (const d of done) {
    const have = lastDone.get(d.query_key)
    if (!have || d.done_at > have) lastDone.set(d.query_key, d.done_at)
  }
  const ms = (iso: string) => Date.parse(iso)
  const groups = new Map<string, UnmetCard & { surfaceSet: Set<string>; roleSet: Set<string> }>()
  let excluded = 0
  for (const r of rows) {
    const key = searchKey(r.query)
    if (!key) continue
    if (excludeReason(r)) {
      excluded++
      continue
    }
    const doneAt = lastDone.get(key)
    if (doneAt && ms(r.created_at) <= ms(doneAt)) continue
    const g =
      groups.get(key) ??
      ({ key, query: r.query.replace(/\s+/g, ' ').trim(), count: 0, city: null, subject: null, level: null, school: null, surfaces: [], roles: [], last: r.created_at, surfaceSet: new Set(), roleSet: new Set() } as UnmetCard & {
        surfaceSet: Set<string>
        roleSet: Set<string>
      })
    g.count++
    g.surfaceSet.add(r.surface)
    g.roleSet.add(r.role ?? 'guest')
    g.city = g.city ?? r.city
    g.subject = g.subject ?? r.subject
    g.level = g.level ?? r.level
    g.school = g.school ?? r.school
    if (ms(r.created_at) > ms(g.last)) g.last = r.created_at
    groups.set(key, g)
  }
  const toReview = [...groups.values()]
    .map(({ surfaceSet, roleSet, ...c }) => ({ ...c, surfaces: [...surfaceSet].sort(), roles: [...roleSet].sort() }))
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last) || a.key.localeCompare(b.key))
  return { toReview, excluded }
}

// --- Search words ------------------------------------------------------------

export type WordTargetKind = 'subject' | 'school' | 'level' | 'city'
export type WordTarget = { kind: WordTargetKind; slug: string; name: string }

/** How a target is stored in taxonomy_aliases: a school is a subject there. */
export function aliasKind(kind: WordTargetKind): 'subject' | 'level' | 'city' {
  return kind === 'school' ? 'subject' : kind
}

/** A search word as stored: lower case, single spaces, 2–40 characters; else null. */
export function cleanWord(v: string | null | undefined): string | null {
  const w = searchKey(v)
  return w.length >= 2 && w.length <= 40 ? w : null
}

/** The picker: targets whose name contains every typed word. */
export function filterTargets(targets: WordTarget[], typed: string, limit = 30): WordTarget[] {
  const words = searchKey(typed).split(' ').filter(Boolean)
  if (words.length === 0) return targets.slice(0, limit)
  return targets.filter((t) => words.every((w) => t.name.toLowerCase().includes(w))).slice(0, limit)
}

// --- Hiring post -------------------------------------------------------------

export const HIRING_TEMPLATE_KEY = 'city_hiring_post'

/** Used when the template row is missing. The same words as the seeded row. */
export const HIRING_TEMPLATE_DEFAULT =
  'Hiring tutors in {city}! Join TutorMint free — find home and online tuitions near you. No commission, no middleman. Join: {join_link}'

/** The ready-to-copy post for one city. {join_link} is the sending staff
 *  member's own join link (owner, 15 Oct 2026); staff with no link of their own
 *  share the sign-up page. */
export function hiringPost(template: string | null | undefined, city: string, joinLink?: string | null): string {
  return (template && template.trim() ? template : HIRING_TEMPLATE_DEFAULT)
    .replace(/\{city\}/g, city.trim())
    .replace(/\{join_link\}/g, joinLink || 'https://www.tutormint.org/register')
}

/** A WhatsApp share link with the text prefilled (no number: the sender picks the
 *  group). Built by waSendHref so an emoji in the editable template survives. */
export function whatsappShareLink(text: string): string {
  return waSendHref(null, text)
}
