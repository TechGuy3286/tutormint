import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import AdminSearch from '@/components/admin/AdminSearch'
import AdminShell from '@/components/admin/AdminShell'
import { approvalNeeded } from '@/lib/approvalQueue'
import AdminSignOut from '@/components/admin/AdminSignOut'
import BridgeBanner from '@/components/admin/BridgeBanner'
import NotificationBell from '@/components/notifications/NotificationBell'
import { getAdminActor, isReadOnlyRole, roleBadge, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { AdminReadOnlyProvider } from '@/components/admin/ReadOnly'
import { NAV_GROUPS, type NavGroup } from '@/lib/adminNav'
import { unreadCount } from '@/lib/notificationFeed'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mfaState, inMfaGrace } from '@/lib/adminMfa'
import MfaGate from '@/components/admin/MfaGate'

// Small sidebar count badges (owner PR9 §6.5): tutors with a document waiting,
// and open reports. Cheap head-count reads; a zero shows no badge (the shell
// omits it). Payments no longer carries a count — transfers activate on submit,
// so there is no pending queue to flag (PR30).
async function navBadges(): Promise<Record<string, number>> {
  const admin = createAdminClient()
  if (!admin) return {}
  const [reports, approvalRows] = await Promise.all([
    admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    // PR106-H1 §3.7: the "Approval needed" count beside People (one source of
    // truth with the tab). Only roles that can open /admin/users see the badge.
    approvalNeeded(),
  ])
  const approvals = approvalRows.length
  return {
    // Tutors with a document waiting — the same list as the queue and the
    // review card (owner, 9 Oct 2026), not a raw verification_state count.
    '/admin/tutors': approvalRows.filter((r) => r.kind === 'tutor').length,
    '/admin/reports': reports.count ?? 0,
    '/admin/users': approvals,
    // Parents with their CNIC or address waiting (owner, 8 Oct 2026).
    '/admin/parents': approvalRows.filter((r) => r.kind === 'parent').length,
  }
}

// Server gate for the whole /admin subtree, plus the shell.
//
// role='admin' plus a non-null admin_role, both settable only by SQL --
// 14_handle_new_user.sql refuses to mint an admin from signup metadata. This
// replaced a client-side password prompt whose literals shipped in the browser
// bundle and which localStorage could bypass.
//
// The nav lists only the screens this admin_role may open, and a group whose
// items were all filtered out does not render at all. Every screen and every
// mutation route re-checks independently: hiding a link is presentation, never
// the control.
//
// The page title and breadcrumbs come from the @pagehead slot rather than from
// here -- see that file for why a layout cannot know its own URL.

export default async function AdminLayout({
  children,
  pagehead,
}: {
  children: React.ReactNode
  pagehead: React.ReactNode
}) {
  const actor = await getAdminActor()

  // Not an admin: the existence of this area is not worth advertising.
  if (!actor) redirect('/')

  // Two-factor gate (PR49 §2). Every staff account must set up an authenticator
  // and enter a code each sign-in. This is the ONE place it is decided, so the
  // panel is shown only to a verified session; the enrol/verify screen renders
  // in place of it otherwise, and cannot lock itself out. A staff member with no
  // factor keeps working during the grace window (mid-deploy) and enrols after.
  const supabase = await createClient()
  const mfa = await mfaState(supabase)
  if (mfa === 'unverified') return <MfaGate mode="verify" email={actor.email} />
  // A Partner (view-only, owner 8 Oct 2026) ALWAYS needs two-factor — never a
  // grace window: until it is set up, every admin page shows the setup screen.
  const readOnly = isReadOnlyRole(actor.adminRole)
  if (mfa === 'none' && (readOnly || !inMfaGrace())) return <MfaGate mode="setup" email={actor.email} />

  const groups: NavGroup[] = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) => !i.screen || roleSatisfies(actor.adminRole, SCREEN_ACCESS[i.screen]),
    ),
  })).filter((g) => g.items.length > 0)

  const jar = await cookies()
  const [unread, badges] = await Promise.all([unreadCount(), navBadges()])

  // The header "Find a member" box commits to /admin/users, which tuitions_staff
  // cannot open (server-refused). Hide it for that role so it isn't offered a
  // door that is locked (PR106-H3 §4).
  const showMemberSearch = actor.adminRole !== 'tuitions_staff'

  return (
    <AdminShell
      groups={groups}
      badges={badges}
      initialCollapsed={jar.get('tm_admin_nav')?.value === 'collapsed'}
      // The badge: "Owner", "Partner", or "Admin" for every other staff role
      // (owner, 8 Oct 2026, item 2). Rights never depend on this word.
      roleLabel={roleBadge(actor.adminRole)}
      email={actor.email}
      pageHead={pagehead}
      search={showMemberSearch ? <AdminSearch /> : null}
      bell={
        <NotificationBell
          userId={actor.id}
          initialUnread={unread}
          emptyHint="Your account has nothing waiting. Member reports and queues are in the sidebar."
          emptyAction={{ label: 'Open reports', href: '/admin/reports' }}
        />
      }
      signOut={<AdminSignOut tone="light" />}
      banner={
        <>
          <BridgeBanner />
          {readOnly && (
            <p className="border-b border-tm-navy/10 bg-tm-tint-navy px-4 py-2 text-center text-[11px] font-bold text-tm-navy">
              View-only Partner account — you can open every page and download reports; nothing can be changed.
            </p>
          )}
        </>
      }
    >
      <AdminReadOnlyProvider readOnly={readOnly}>{children}</AdminReadOnlyProvider>
    </AdminShell>
  )
}
