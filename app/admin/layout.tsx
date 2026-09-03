import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import AdminSearch from '@/components/admin/AdminSearch'
import AdminShell from '@/components/admin/AdminShell'
import AdminSignOut from '@/components/admin/AdminSignOut'
import NotificationBell from '@/components/notifications/NotificationBell'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { NAV_GROUPS, type NavGroup } from '@/lib/adminNav'
import { unreadCount } from '@/lib/notificationFeed'

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

  const groups: NavGroup[] = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) => !i.screen || roleSatisfies(actor.adminRole, SCREEN_ACCESS[i.screen]),
    ),
  })).filter((g) => g.items.length > 0)

  const jar = await cookies()
  const unread = await unreadCount()

  return (
    <AdminShell
      groups={groups}
      initialCollapsed={jar.get('tm_admin_nav')?.value === 'collapsed'}
      roleLabel={actor.adminRole}
      email={actor.email}
      pageHead={pagehead}
      search={<AdminSearch />}
      bell={
        <NotificationBell
          initialUnread={unread}
          emptyHint="Your account has nothing waiting. Member reports and queues are in the sidebar."
          emptyAction={{ label: 'Open reports', href: '/admin/reports' }}
        />
      }
      signOut={<AdminSignOut tone="light" />}
    >
      {children}
    </AdminShell>
  )
}
