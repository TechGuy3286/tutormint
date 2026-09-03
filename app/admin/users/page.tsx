import Link from 'next/link'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { findJunkAccounts } from '@/lib/cleanup'
import CleanupClient from './CleanupClient'
import MemberSearch from './MemberSearch'
import MemberRow from './MemberRow'
import MoreMembers from './MoreMembers'
import { memberPage } from '@/lib/memberFeed'

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

// One window. The list scrolls, so this is a window size, not a cap.
const PAGE_SIZE = 100

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

  // The first window server-side; MoreMembers appends the rest from a keyset
  // cursor. This list used to stop at 100 and say "First 100 matches" in the
  // heading — honest about being truncated, and useless as a directory.
  const { rows, nextCursor } = await memberPage({
    filters: { q, role, status },
    limit: PAGE_SIZE,
  })
  const term = q.trim()

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
        <p className="text-xs text-gray-500">
          Every account, newest first{term ? ` matching “${term}”` : ''}.
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
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nobody matches that.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <MemberRow key={r.id} row={r} />
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <MoreMembers
          params={{
            ...(term ? { q: term } : {}),
            ...(role !== 'all' ? { role } : {}),
            ...(status !== 'all' ? { status } : {}),
          }}
          initialCursor={nextCursor}
          serverCount={rows.length}
        />
      )}
    </div>
  )
}
