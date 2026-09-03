import { createAdminClient } from '@/lib/supabase/admin'
import { decodeCursor, encodeCursor } from '@/lib/cursor'

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
  role: string
  slug: string | null
  completion: number
  verified: boolean
  suspended: boolean
  plan: string | null
  createdAt: string
}

export type MemberFilters = { q: string; role: string; status: string }

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
}): Promise<{ rows: MemberRow[]; nextCursor: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], nextCursor: null }

  let query = admin
    .from('profiles')
    .select(
      'id, full_name, email, phone_number, role, profile_completion, cnic_verified_at, address_verified_at, is_suspended, created_at',
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
    query = query.or(clauses.join(','))
  }

  if (filters.role === 'tutor') query = query.eq('role', 'tutor')
  else if (filters.role === 'parent') query = query.in('role', ['parent', 'academy'])
  else if (filters.role === 'admin') query = query.eq('role', 'admin')

  if (filters.status === 'suspended') query = query.eq('is_suspended', true)

  const after = decodeCursor<MemberCursor>(cursor)
  if (after) {
    query = query.or(
      [`created_at.lt."${after.c}"`, `and(created_at.eq."${after.c}",id.lt."${after.i}")`].join(','),
    )
  } else if (offset > 0) {
    query = query.range(offset, offset + limit - 1)
  }

  const { data: profiles } = await query
  const ids = (profiles ?? []).map((p) => p.id as string)
  const none = ['00000000-0000-0000-0000-000000000000']

  const [{ data: tutorRows }, { data: subs }, { data: plans }] = await Promise.all([
    admin.from('tutor_profiles').select('id, slug').in('id', ids.length ? ids : none),
    admin
      .from('subscriptions')
      .select('user_id, plan_code')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .in('user_id', ids.length ? ids : none),
    admin.from('plans').select('code, name'),
  ])

  const slugById = new Map((tutorRows ?? []).map((t) => [t.id as string, t.slug as string]))
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
      name: (p.full_name as string) ?? '—',
      email: (p.email as string) ?? '—',
      phone: (p.phone_number as string) || null,
      role: p.role as string,
      slug: slugById.get(p.id as string) ?? null,
      completion: (p.profile_completion as number) ?? 0,
      verified,
      suspended: !!p.is_suspended,
      plan: planCode ? (planName.get(planCode) ?? planCode) : null,
      createdAt: p.created_at as string,
    }
  })

  const last = rows[rows.length - 1]

  return {
    rows,
    // A short window is the end. There is no cheap exact count for a filtered
    // profiles query, and counting on every request to decide whether to draw
    // one button is not worth a second full scan.
    nextCursor:
      rows.length < limit || !last
        ? null
        : encodeCursor({ c: last.createdAt, i: last.id } satisfies MemberCursor),
  }
}
