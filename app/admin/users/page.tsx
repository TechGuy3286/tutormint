import { Download, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { findJunkAccounts } from '@/lib/cleanup'
import CleanupClient from './CleanupClient'
import MemberSearch from './MemberSearch'
import MemberRow from './MemberRow'
import MoreMembers from './MoreMembers'
import { memberPage } from '@/lib/memberFeed'
import { isTipKey, resolveTipMemberIds } from '@/lib/adminTips'

const TIP_LABEL: Record<string, string> = {
  'unpaid-tutors': 'Unpaid tutors',
  'listed-unpaid': 'Listed but unpaid',
  'never-filled': 'Signed up, never filled',
}

// The member directory. owner / manager / support.
//
// Operations reaches individual members only through links from its own queues,
// never through a browsable list of everyone — requireAdminRole redirects it to
// /admin, and the member page repeats the check.
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
  searchParams: Promise<{ q?: string; role?: string; status?: string; filter?: string; tip?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.users)
  const { q = '', role = 'all', status = 'all', filter, tip } = await searchParams

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

  // A conversion tip (from the overview) resolves to an id allowlist. When one
  // is active it overrides the role/status chips — the list IS that worklist.
  const activeTip = tip && isTipKey(tip) ? tip : null
  const tipIds = activeTip ? await resolveTipMemberIds(activeTip) : null

  // The first window server-side; MoreMembers appends the rest from a keyset
  // cursor. This list used to stop at 100 and say "First 100 matches" in the
  // heading — honest about being truncated, and useless as a directory.
  const { rows, nextCursor, count } = await memberPage({
    filters: { q, role, status, ids: tipIds },
    limit: PAGE_SIZE,
  })
  const term = q.trim()

  const exportQs = [
    term ? `q=${encodeURIComponent(term)}` : '',
    role !== 'all' ? `role=${role}` : '',
    status !== 'all' ? `status=${status}` : '',
  ]
    .filter(Boolean)
    .join('&')
  const exportHref = `/api/admin/users/export${exportQs ? `?${exportQs}` : ''}`

  // ONE mutually-exclusive filter. role and status used to be independent, so
  // "Everyone" (role=all) and "Suspended only" (status=suspended) could both be
  // active — the list then showed only suspended members while "Everyone" looked
  // selected. The five chips are one single-select group now: the active value
  // is the status filter when it is set, otherwise the role.
  const active = status === 'suspended' ? 'suspended' : role
  const chip = (value: string, label: string) => {
    const params = new URLSearchParams()
    if (term) params.set('q', term)
    // Each chip sets exactly one dimension and clears the other, so no two are
    // ever active at once.
    if (value === 'suspended') params.set('status', 'suspended')
    else if (value !== 'all') params.set('role', value)
    const href = `/admin/users${params.toString() ? `?${params}` : ''}`
    return (
      <Link
        key={value}
        href={href}
        className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
          active === value
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
        {activeTip ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy">
              {TIP_LABEL[activeTip]}
            </span>
            <span>
              {count} {count === 1 ? 'tutor' : 'tutors'}.
            </span>
            <Link href="/admin/users" className="font-bold text-tm-red hover:underline">
              Clear
            </Link>
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            {count} {count === 1 ? 'person' : 'people'}
            {active === 'tutor' ? ' — tutors' : active === 'parent' ? ' — parents' : active === 'admin' ? ' — staff' : active === 'suspended' ? ' — suspended' : ''}
            {term ? ` matching “${term}”` : ''}.
          </p>
        )}
      </header>

      {!activeTip && <MemberSearch initialQuery={term} role={role} status={status} />}

      {/* Chips and search are hidden while a tip worklist is active — the list
          IS the tip; the "Clear" link above returns to the directory. */}
      {!activeTip && (
        <div className="flex flex-wrap gap-2">
          {chip('all', 'Everyone')}
          {chip('tutor', 'Tutors')}
          {chip('parent', 'Parents')}
          {chip('admin', 'Staff')}
          {chip('suspended', 'Suspended only')}
          {roleSatisfies(actor.adminRole, SCREEN_ACCESS.cleanup) && (
            <Link
              href="/admin/users?filter=suspicious"
              className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-tm-gold/30 bg-tm-tint-gold px-4 text-xs font-bold text-tm-gold-ink"
            >
              <Trash2 aria-hidden size={14} />
              Junk accounts
            </Link>
          )}
          {/* Export honours the active filters and is owner + manager only; the
              route audit-logs every download. */}
          {roleSatisfies(actor.adminRole, SCREEN_ACCESS.usersExport) && (
            <a
              href={exportHref}
              className="gap-1.5 ml-auto inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
            >
              <Download aria-hidden size={14} />
              Export CSV
            </a>
          )}
        </div>
      )}

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
          params={
            activeTip
              ? { tip: activeTip }
              : {
                  ...(term ? { q: term } : {}),
                  ...(role !== 'all' ? { role } : {}),
                  ...(status !== 'all' ? { status } : {}),
                }
          }
          initialCursor={nextCursor}
          serverCount={rows.length}
        />
      )}
    </div>
  )
}
