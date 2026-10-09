import type { Role } from '@/lib/authRoutes'

// The signed-in member's menu, in ONE place.
//
// The brief for this was explicit: never two hand-maintained copies. That is
// not fussiness — the header menu and the mobile sheet are the same list, and
// the moment they are two arrays the phone menu quietly loses whatever was
// added last. They render from this.
//
// PLAIN DATA, deliberately. This is built on the server (the header is a server
// component, so the menu is right on the first byte rather than after a fetch)
// and handed to a client component to render, which means every field has to
// survive serialisation. Hence `icon` is a string key the client maps to a
// lucide component, not the component itself.
//
// It also means this file must import nothing server-only. SCREEN_ACCESS lives
// in lib/adminAuth.ts, which reaches for next/navigation and the cookie-backed
// Supabase client and cannot be bundled for the browser — so the caller does
// the filtering and passes the result in, rather than this file importing it.

export type MenuIcon =
  | 'dashboard'
  | 'applications'
  | 'messages'
  | 'bell'
  | 'profile'
  | 'package'
  | 'settings'
  | 'help'
  | 'logout'
  | 'post'
  | 'jobs'
  | 'hired'
  | 'demos'
  | 'browse'
  | 'shield'

export type MenuItem = {
  label: string
  href: string
  icon: MenuIcon
  /** Rendered with a divider above it — the account/exit group. */
  separated?: boolean
}

/** An admin screen the actor may actually open, resolved by the caller. */
export type AdminEntry = { label: string; href: string }

// Tutors and parents NO LONGER have an account menu (owner, 9 Oct 2026):
// Settings and Logout are always-visible header controls
// (components/MemberHeaderNav.tsx) and Help & Support sits on the dashboard
// profile card. This menu now serves admins (and a role-less session) only.

/**
 * The menu for this member.
 *
 * Admins keep their screen list — the admin panel is where they work. Tutors
 * and parents are never given this menu (see MemberHeaderNav); Logout is added
 * by the UI.
 *
 * `adminScreens` is already filtered by SCREEN_ACCESS by the caller, so a
 * verifier never sees Payments here even though the entry exists in the nav.
 */
export function menuForRole({
  role,
  adminScreens = [],
}: {
  role: Role | null
  adminScreens?: AdminEntry[]
}): MenuItem[] {
  if (role === 'admin') {
    return [
      { label: 'Admin panel', href: '/admin', icon: 'shield' },
      ...adminScreens.map((s): MenuItem => ({ label: s.label, href: s.href, icon: 'shield' })),
      // An admin is still a member: these are their own account, not the
      // platform's, which is why they sit below the divider.
      { label: 'Notifications', href: '/account/notifications', icon: 'bell', separated: true },
      { label: 'Settings', href: '/account/notifications/settings', icon: 'settings' },
      { label: 'Help & Support', href: '/support', icon: 'help' },
    ]
  }

  // No silent parent default (owner, 9 Sep). A session with no role is a broken
  // profile (the dropped-trigger orphan), not a parent. Show only the account
  // items every member has, whatever their role.
  return [
    { label: 'Settings', href: '/account/notifications/settings', icon: 'settings' },
    { label: 'Help & Support', href: '/support', icon: 'help' },
  ]
}
