import Link from 'next/link'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { findJunkAccounts } from '@/lib/cleanup'
import CleanupClient from './CleanupClient'
import MemberSearch from './MemberSearch'

// The member directory. owner / manager / support.
//
// Verifier and finance reach individual members only through links from their
// own queues, never through a browsable list of everyone — requireAdminRole
// redirects them to /admin, and the member page repeats the check.
//
// Search runs on the server against name, email, phone and slug. The input is a
// plain GET, so a search is a URL: an admin can send a colleague a link to the
// exact list they were looking at, and the back button behaves.

export const dynamic = 'force-dynamic'

type Row = {
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

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; filter?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.users)
  const { q = '', role = 'all', status = 'all', filter } = await searchParams

  // ?filter=suspicious is the junk-account cleanup, and it is owner-only —
  // narrower than the directory it lives inside. A manager or support admin
  // who types the URL gets the ordinary list, not a 403 they cannot act on.
  if (filter === 'suspicious' && roleSatisfies(actor.adminRole, SCREEN_ACCESS.cleanup)) {
    const { candidates, scanned } = await findJunkAccounts()
    return <CleanupClient candidates={candidates} scanned={scanned} />
  }

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  let query = admin
    .from('profiles')
    .select(
      'id, full_name, email, phone_number, role, profile_completion, cnic_verified_at, address_verified_at, is_suspended, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  const term = q.trim()
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

  if (role === 'tutor') query = query.eq('role', 'tutor')
  else if (role === 'parent') query = query.in('role', ['parent', 'academy'])
  else if (role === 'admin') query = query.eq('role', 'admin')

  if (status === 'suspended') query = query.eq('is_suspended', true)

  const { data: profiles } = await query
  const ids = (profiles ?? []).map((p) => p.id as string)

  const [{ data: tutorRows }, { data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('tutor_profiles')
      .select('id, slug')
      .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    admin
      .from('subscriptions')
      .select('user_id, plan_code')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    admin.from('plans').select('code, name'),
  ])

  const slugById = new Map((tutorRows ?? []).map((t) => [t.id as string, t.slug as string]))
  const planByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s.plan_code as string]))
  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))

  const rows: Row[] = (profiles ?? []).map((p) => {
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

  const chip = (key: string, value: string, label: string, current: string) => {
    const params = new URLSearchParams()
    if (term) params.set('q', term)
    if (key === 'role') {
      if (value !== 'all') params.set('role', value)
      if (status !== 'all') params.set('status', status)
    } else {
      if (role !== 'all') params.set('role', role)
      if (value !== 'all') params.set('status', value)
    }
    const href = `/admin/users${params.toString() ? `?${params}` : ''}`
    return (
      <Link
        key={`${key}-${value}`}
        href={href}
        className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
          current === value
            ? 'bg-tm-black text-white'
            : 'border border-gray-200 bg-white text-slate-700'
        }`}
      >
        {label}
      </Link>
    )
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Members</h1>
        <p className="text-xs text-gray-500">
          {rows.length === 100 ? 'First 100 matches' : `${rows.length} member${rows.length === 1 ? '' : 's'}`}
          {term ? ` matching “${term}”` : ''}
        </p>
      </header>

      <MemberSearch initialQuery={term} role={role} status={status} />

      <div className="flex flex-wrap gap-2">
        {chip('role', 'all', 'Everyone', role)}
        {chip('role', 'tutor', 'Tutors', role)}
        {chip('role', 'parent', 'Parents', role)}
        {chip('role', 'admin', 'Staff', role)}
        {chip('status', 'suspended', 'Suspended only', status)}
        {roleSatisfies(actor.adminRole, SCREEN_ACCESS.cleanup) && (
          <Link
            href="/admin/users?filter=suspicious"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-tm-gold/30 bg-tm-tint-gold px-4 text-xs font-bold text-tm-gold-ink"
          >
            Junk accounts
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          Nobody matches that.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/users/${r.id}`}
                className={`block space-y-1 rounded-2xl border bg-white p-4 transition-colors hover:border-tm-navy ${
                  r.suspended ? 'border-tm-gold/30' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-black text-tm-navy">{r.name}</p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.suspended && (
                      <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-black uppercase text-tm-gold-ink">
                        suspended
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                      {r.role}
                    </span>
                  </span>
                </div>
                <p className="truncate text-[11px] text-gray-500">
                  {r.email}
                  {r.phone ? ` · ${r.phone}` : ''}
                  {r.slug ? ` · /tutor/${r.slug}` : ''}
                </p>
                <p className="text-[11px] text-gray-400">
                  {r.plan ?? 'No plan'} · {r.completion}% complete ·{' '}
                  {r.verified ? 'verified' : 'not verified'} · joined{' '}
                  {new Date(r.createdAt).toLocaleDateString('en-PK')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
