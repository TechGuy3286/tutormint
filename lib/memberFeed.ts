import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { fuzzyEq, norm } from '@/lib/smartSearchCore'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { formatName } from '@/lib/formatName'
import { stoppedAtByTutor } from '@/lib/onboardingStop'

// One window of the member directory, shared by /admin/users and its
// load-more route.
//
// This list used to stop at 100 and SAY SO — the heading read "First 100
// matches". That is honest about being truncated and useless as a directory:
// the member an admin is looking for is as likely to be the 140th as the 40th,
// and the only way to reach them was a search term precise enough that you
// already knew who they were. It scrolls now.
//
// (created_at, id) is the key. Signups share a second often enough during a
// campaign that created_at alone is not unique, and a non-unique key means a
// cursor cannot say which side of a tie it is on.

export type MemberRow = {
  id: string
  name: string
  email: string
  phone: string | null
  whatsapp: string | null
  city: string | null
  role: string
  slug: string | null
  completion: number
  verified: boolean
  suspended: boolean
  banned: boolean
  /** The member paused their own account (migration 151), or null. */
  pausedByUserAt: string | null
  /** How the mobile was proved: 'otp' | 'bridge' | null. */
  phoneVerifiedVia: string | null
  plan: string | null
  createdAt: string
  /** An incomplete tutor's first unfinished onboarding step ("Subjects"). */
  stoppedAt: string | null
}

export type MemberFilters = {
  q: string
  role: string
  status: string
  /** An id allowlist (a conversion tip resolves to a set of member ids). null =
   *  no restriction; an empty array = nobody, and the query returns no rows. */
  ids?: string[] | null
}

type MemberCursor = { c: string; i: string }

export async function memberPage({
  filters,
  limit,
  offset = 0,
  cursor = null,
}: {
  filters: MemberFilters
  limit: number
  offset?: number
  cursor?: string | null
}): Promise<{ rows: MemberRow[]; nextCursor: string | null; count: number }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], nextCursor: null, count: 0 }

  // count:'exact' gives the total matching the filters, independent of limit —
  // the first window (no cursor) uses it for the "N members" line. On a
  // cursored load-more the count reflects only the tail, which no caller reads.
  let query = admin
    .from('profiles')
    .select(
      'id, full_name, email, phone_number, whatsapp, city, role, profile_completion, cnic_verified_at, address_verified_at, is_suspended, is_banned, paused_by_user_at, phone_verified_via, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  const term = filters.q.trim()
  if (term) {
    // A slug search is resolved first and folded into the same OR, so one box
    // matches "usman", "seed+verified-usman@…", "0300…" and "verified-usman".
    const { data: bySlug } = await admin
      .from('tutor_profiles')
      .select('id')
      .ilike('slug', `%${term}%`)
      .limit(50)

    const slugIds = (bySlug ?? []).map((t) => t.id as string)
    const escaped = term.replace(/[%,()]/g, '')
    const clauses = [
      `full_name.ilike.%${escaped}%`,
      `email.ilike.%${escaped}%`,
      `phone_number.ilike.%${escaped}%`,
    ]
    if (slugIds.length > 0) clauses.push(`id.in.(${slugIds.join(',')})`)
    // Typo tolerance (owner, 8 Oct 2026): "aqsa mugal" still finds Aqsa Mughal —
    // the same edit-distance rule the public search uses, over every name.
    const fuzzyIds = await fuzzyNameIds(admin, term)
    if (fuzzyIds.length > 0) clauses.push(`id.in.(${fuzzyIds.join(',')})`)
    query = query.or(clauses.join(','))
  }

  if (filters.role === 'tutor') query = query.eq('role', 'tutor')
  else if (filters.role === 'parent') query = query.in('role', ['parent', 'academy'])
  else if (filters.role === 'admin') query = query.eq('role', 'admin')

  if (filters.status === 'suspended') query = query.eq('is_suspended', true)

  // A conversion-tip id allowlist. An empty array means the tip matched nobody,
  // so short-circuit to an empty page rather than an unfiltered one.
  if (filters.ids) {
    if (filters.ids.length === 0) return { rows: [], nextCursor: null, count: 0 }
    query = query.in('id', filters.ids)
  }

  const after = decodeCursor<MemberCursor>(cursor)
  if (after) {
    query = query.or(
      [`created_at.lt."${after.c}"`, `and(created_at.eq."${after.c}",id.lt."${after.i}")`].join(','),
    )
  } else if (offset > 0) {
    query = query.range(offset, offset + limit - 1)
  }

  const { data: profiles, count } = await query
  const ids = (profiles ?? []).map((p) => p.id as string)
  const none = ['00000000-0000-0000-0000-000000000000']

  const [{ data: tutorRows }, { data: subs }, { data: plans }] = await Promise.all([
    // `city` too: for a tutor the directory (and the CSV export, PR 3b §0.6) read
    // tutor_profiles.city, not profiles.city.
    admin.from('tutor_profiles').select('id, slug, city').in('id', ids.length ? ids : none),
    admin
      .from('subscriptions')
      .select('user_id, plan_code')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .in('user_id', ids.length ? ids : none),
    admin.from('plans').select('code, name'),
  ])

  // "Stopped at: <step>" for every incomplete tutor on this page (hotfix 7 Oct).
  const incompleteTutors = (profiles ?? [])
    .filter((p) => p.role === 'tutor' && ((p.profile_completion as number) ?? 0) < 100)
    .map((p) => p.id as string)
  const stoppedAt = await stoppedAtByTutor(admin, incompleteTutors).catch(() => new Map<string, string>())

  const slugById = new Map((tutorRows ?? []).map((t) => [t.id as string, t.slug as string]))
  const tutorCityById = new Map((tutorRows ?? []).map((t) => [t.id as string, (t.city as string | null) ?? null]))
  const planByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s.plan_code as string]))
  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))

  const rows: MemberRow[] = (profiles ?? []).map((p) => {
    const verified = !!p.cnic_verified_at && !!p.address_verified_at
    // Same rule getEntitlements uses: a verified parent is on the free plan
    // with no subscription row of their own.
    let planCode = planByUser.get(p.id as string) ?? null
    if (!planCode && p.role !== 'tutor' && p.role !== 'admin' && verified) {
      planCode = 'parent_verified'
    }
    return {
      id: p.id as string,
      name: formatName(p.full_name as string | null) || '—',
      email: (p.email as string) ?? '—',
      phone: (p.phone_number as string) || null,
      whatsapp: (p.whatsapp as string) || null,
      // A tutor's city is tutor_profiles.city; everyone else's is profiles.city.
      city:
        p.role === 'tutor'
          ? (tutorCityById.get(p.id as string) || null)
          : ((p.city as string) || null),
      role: p.role as string,
      slug: slugById.get(p.id as string) ?? null,
      completion: (p.profile_completion as number) ?? 0,
      verified,
      suspended: !!p.is_suspended,
      banned: !!p.is_banned,
      pausedByUserAt: (p.paused_by_user_at as string | null) ?? null,
      phoneVerifiedVia: (p.phone_verified_via as string) ?? null,
      plan: planCode ? (planName.get(planCode) ?? planCode) : null,
      createdAt: p.created_at as string,
      stoppedAt: stoppedAt.get(p.id as string) ?? null,
    }
  })

  const last = rows[rows.length - 1]

  return {
    rows,
    nextCursor:
      rows.length < limit || !last
        ? null
        : encodeCursor({ c: last.createdAt, i: last.id } satisfies MemberCursor),
    // The total matching the filters (from count:'exact'), for the "N members"
    // line. Accurate on the first window (no cursor), which is where it is read.
    count: count ?? rows.length,
  }
}

/**
 * Every member matching the active filters, for the CSV export. Reuses
 * memberPage so the export honours EXACTLY the filters the admin is looking at
 * (same q/role/status logic, same plan/verification resolution). Bounded: the
 * member base is small, and the cap + page ceiling stop any runaway.
 */
export async function allMembersForExport(filters: MemberFilters, cap = 5000): Promise<MemberRow[]> {
  const pageSize = 200
  const out: MemberRow[] = []
  let cursor: string | null = null
  for (let i = 0; i < Math.ceil(cap / pageSize) && out.length < cap; i++) {
    const { rows, nextCursor }: { rows: MemberRow[]; nextCursor: string | null } = await memberPage({
      filters,
      limit: pageSize,
      cursor,
    })
    out.push(...rows)
    if (!nextCursor) break
    cursor = nextCursor
  }
  return out.slice(0, cap)
}

/** Members whose name matches the typed words allowing small typos. Every word
 *  of the search must be close to some word of the name. Capped at 100 ids. */
async function fuzzyNameIds(admin: NonNullable<ReturnType<typeof createAdminClient>>, term: string): Promise<string[]> {
  const words = norm(term).split(' ').filter((w) => w.length >= 3 && /[a-z]/.test(w))
  if (words.length === 0) return []
  const rows = await pageAll((from, to) => admin.from('profiles').select('id, full_name').order('id').range(from, to))
  const out: string[] = []
  for (const r of rows) {
    const nameWords = norm((r.full_name as string | null) ?? '').split(' ').filter(Boolean)
    if (nameWords.length === 0) continue
    const ok = words.every((w) => nameWords.some((n) => n.startsWith(w) || fuzzyEq(w, n) != null))
    if (ok) out.push(r.id as string)
    if (out.length >= 100) break
  }
  return out
}
