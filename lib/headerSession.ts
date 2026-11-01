import 'server-only'

import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { getSessionUser } from '@/lib/auth'
import { unreadCount } from '@/lib/notificationFeed'
import { unreadMessageCount } from '@/lib/messaging'
import { tutorGender } from '@/lib/memberGender'
import { createClient } from '@/lib/supabase/server'
import { menuForRole, type AdminEntry, type MenuItem } from '@/lib/userMenu'
import { currentViewAs } from '@/lib/viewAs'
import type { HeaderSession } from '@/lib/headerSessionCore'

// The signed-in part of the site header, worked out for ONE request to
// /api/session/header (push 3, owner 1 Nov 2026). It used to be rendered by the
// server Navbar on every page, and reading the session cookie there made every
// public page render per request. Public pages now carry only the logo and the
// guest buttons; the browser asks this route for the rest, and only when a
// Supabase sign-in cookie is present (lib/headerSessionCore hasAuthCookie).

/** The admin screens this actor may actually open, for their menu. The same
 *  SCREEN_ACCESS entries the nav and every guard read, so the menu never offers
 *  a door that is locked. */
async function adminScreensFor(): Promise<AdminEntry[]> {
  const actor = await getAdminActor()
  if (!actor) return []
  const candidates: { label: string; href: string; allowed: (typeof SCREEN_ACCESS)['tutors'] }[] = [
    { label: 'Payments', href: '/admin/payments', allowed: SCREEN_ACCESS.payments },
    { label: 'Reports', href: '/admin/reports', allowed: SCREEN_ACCESS.reports },
    { label: 'People', href: '/admin/users', allowed: SCREEN_ACCESS.usersView },
  ]
  return candidates.filter((c) => roleSatisfies(actor.adminRole, c.allowed)).map(({ label, href }) => ({ label, href }))
}

export async function loadHeaderSession(): Promise<HeaderSession> {
  const session = await getSessionUser()
  if (!session) return { signedIn: false }

  const role = session.profile?.role ?? null
  const name = session.profile?.full_name ?? session.user.email?.split('@')[0] ?? 'there'
  const isMember = role === 'tutor' || role === 'parent'
  const [unread, adminScreens, messagesUnread, gender, viewAs] = await Promise.all([
    unreadCount(),
    role === 'admin' ? adminScreensFor() : Promise.resolve([] as AdminEntry[]),
    isMember ? unreadMessageCount(session.user.id) : Promise.resolve(0),
    role === 'tutor' ? createClient().then((c) => tutorGender(c, session.user.id)) : Promise.resolve(null),
    isMember ? currentViewAs() : Promise.resolve(null),
  ])
  const items: MenuItem[] = menuForRole({ role, adminScreens })
  return {
    signedIn: true,
    userId: session.user.id,
    role,
    name,
    avatarUrl: session.profile?.avatar_url ?? null,
    gender,
    unread,
    messagesUnread,
    items,
    viewAsName: viewAs?.name ?? null,
  }
}
