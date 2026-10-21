import Link from 'next/link'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { findJunkAccounts } from '@/lib/cleanup'
import CleanupClient from './CleanupClient'
import MemberRow from './MemberRow'
import MoreMembers from './MoreMembers'
import { memberPage } from '@/lib/memberFeed'
import { isTipKey, resolveTipMemberIds } from '@/lib/adminTips'
import { redirect } from 'next/navigation'
import { peopleHref, pickPeopleTab } from '@/lib/peopleDirectoryCore'
import PeopleTabs from './PeopleTabs'

const TIP_LABEL: Record<string, string> = {
  'unpaid-tutors': 'Unpaid tutors',
  'listed-unpaid': 'Listed but unpaid',
  'never-filled': 'Signed up, never filled',
}

// People (owner, 21 Oct 2026): three tabs, Tutors | Parents | Staff — see
// PeopleTabs. This page also keeps the junk-account cleanup and the Overview
// conversion-tip worklists.
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
  searchParams: Promise<{ q?: string; role?: string; status?: string; filter?: string; tip?: string; tab?: string; all?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.users)
  const { role = 'all', filter, tip, tab, all } = await searchParams

  // ?filter=suspicious is the junk-account cleanup, and it is owner-only —
  // narrower than the directory it lives inside. A manager or support admin
  // who types the URL gets the ordinary list, not a 403 they cannot act on.
  if (filter === 'suspicious' && roleSatisfies(actor.adminRole, SCREEN_ACCESS.cleanup)) {
    const { candidates, scanned } = await findJunkAccounts()
    return <CleanupClient candidates={candidates} scanned={scanned} />
  }

  // "Approval needed" became the Tutors tab's Waiting chip (owner, 21 Oct 2026).
  if (filter === 'approval') redirect(peopleHref('tutors', { docs: 'waiting' }))

  // A conversion tip from the Overview keeps its own worklist below. Without
  // one, People is the three tabs (owner, 21 Oct 2026). The old role and
  // status chips (?role=, ?status=) open the matching tab.
  if (!tip || !isTipKey(tip)) {
    const legacy = role === 'parent' ? 'parents' : role === 'admin' ? 'staff' : role === 'tutor' ? 'tutors' : null
    return <PeopleTabs tab={legacy ?? pickPeopleTab(tab)} showAll={all === '1'} role={actor.adminRole} />
  }

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  // A conversion tip (from the overview) resolves to an id allowlist — the
  // list IS that worklist.
  const activeTip = tip
  const tipIds = await resolveTipMemberIds(activeTip)
  const { rows, nextCursor, count } = await memberPage({
    filters: { q: '', role: 'all', status: 'all', ids: tipIds },
    limit: PAGE_SIZE,
  })

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy">{TIP_LABEL[activeTip]}</span>
          <span>
            {count} {count === 1 ? 'tutor' : 'tutors'}.
          </span>
          <Link href="/admin/users" className="font-bold text-tm-red hover:underline">
            Clear
          </Link>
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">Nobody matches that.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <MemberRow key={r.id} row={r} />
          ))}
        </ul>
      )}

      {rows.length > 0 && <MoreMembers params={{ tip: activeTip }} initialCursor={nextCursor} serverCount={rows.length} />}
    </div>
  )
}
