import { applicantsToForwardCount } from '@/lib/applicantForwards'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import AdminSearch from '@/components/admin/AdminSearch'
import AdminShell from '@/components/admin/AdminShell'
import { peopleWaitingCount } from '@/lib/peopleDirectory'
import AdminSignOut from '@/components/admin/AdminSignOut'
import BridgeBanner from '@/components/admin/BridgeBanner'
import NotificationBell from '@/components/notifications/NotificationBell'
import { getAdminActor, alwaysNeedsTwoFactor, roleBadge, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import { AdminReadOnlyProvider, ViewOnlyChip } from '@/components/admin/ReadOnly'
import { NAV_GROUPS, type NavGroup } from '@/lib/adminNav'
import { unreadCount } from '@/lib/notificationFeed'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mfaState, inMfaGrace } from '@/lib/adminMfa'
import MfaGate from '@/components/admin/MfaGate'
import { receiptsWaitingCount } from '@/lib/payments/receipt'

// Small sidebar count badges (owner PR9 §6.5): tutors with a document waiting,
// and open reports. Cheap head-count reads; a zero shows no badge (the shell
// omits it). Payments counts the bank-transfer receipts waiting for approval.
async function navBadges(): Promise<Record<string, number>> {
  const admin = createAdminClient()
  if (!admin) return {}
  const [toForward, reports, waiting, receipts] = await Promise.all([
    // Marketplace → Applicants to forward: the "To forward" tab's count.
    applicantsToForwardCount(),
    admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    // Documents waiting for the Owner, tutors and parents together — the People
    // tabs' own Waiting chips (owner, 21 Oct 2026; lib/peopleDirectory). Only
    // roles that can open /admin/users see the badge.
    peopleWaitingCount(),
    // Payments: bank-transfer receipts waiting for a decision (owner, 11 Oct 2026).
    receiptsWaitingCount(),
  ])
  return {
    '/admin/reports': reports.count ?? 0,
    '/admin/payments': receipts,
    '/admin/jobs/applicants': toForward,
    '/admin/users': waiting,
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
  // Every staff role ALWAYS needs two-factor (owner, 15 Oct 2026; it was the
  // Partner only) — never a grace window: until it is set
  // up, every admin page shows the setup screen.
  // The Partner edits tutors, parents and tuitions and views everything else
  // (owner, 13 Oct 2026). Which pages are view-only is decided per page address
  // in components/admin/ReadOnly; the server refuses the writes regardless.
  const readOnly = actor.adminRole === 'partner'
  if (mfa === 'none' && (alwaysNeedsTwoFactor(actor.adminRole) || !inMfaGrace())) return <MfaGate mode="setup" email={actor.email} />

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
      // The badge: "Project Manager" for the Owner and the Partner, "Admin" for
      // every other staff role (owner, 13 Oct 2026). Rights never depend on it.
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
              You can edit tutors, parents and tuitions. Every other page is view only for your account.
            </p>
          )}
        </>
      }
    >
      <AdminReadOnlyProvider readOnly={readOnly} canApprove={canApprove(actor.adminRole)}>
        <ViewOnlyChip />
        {children}
      </AdminReadOnlyProvider>
    </AdminShell>
  )
}
