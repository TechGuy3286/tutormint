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

// Navigation lives HERE, and only here.
//
// Both dashboards used to end in full-width outlined buttons — "Messages",
// "Browse tutors" — styled exactly like a form's Save and Cancel. They went
// somewhere rather than doing something, so they belong in this list; the
// dashboards keep only the buttons that act (Post a job, Apply, Verify now).
// Every destination removed from a dashboard in that pass is reachable from
// one of these two arrays.
const TUTOR: MenuItem[] = [
  { label: 'Dashboard', href: '/tutor/dashboard', icon: 'dashboard' },
  // Was labelled "My Applications" and pointed at /tutor/dashboard/jobs, which
  // is the OPEN TUITIONS board — not this tutor's applications, which had no
  // screen at all until now. Two entries, each going where it says.
  { label: 'My applications', href: '/tutor/dashboard/applications', icon: 'applications' },
  { label: 'Open tuitions', href: '/tutor/dashboard/jobs', icon: 'jobs' },
  { label: 'Messages', href: '/tutor/dashboard/messages', icon: 'messages' },
  { label: 'Demo requests', href: '/tutor/dashboard/demos', icon: 'demos' },
  { label: 'Notifications', href: '/account/notifications', icon: 'bell' },
  { label: 'Browse tuitions', href: '/browse/tuitions', icon: 'browse' },
  { label: 'Packages', href: '/tutor/packages', icon: 'package' },
  { label: 'Settings', href: '/tutor/dashboard/settings', icon: 'settings', separated: true },
]

const PARENT: MenuItem[] = [
  { label: 'Dashboard', href: '/parent/dashboard', icon: 'dashboard' },
  { label: 'Post a job', href: '/parent/dashboard/post-job', icon: 'post' },
  // Was "My Jobs" pointing back at /parent/dashboard, because the list was
  // rendered inline there. It has its own page now.
  { label: 'My tuitions', href: '/parent/dashboard/jobs', icon: 'jobs' },
  { label: 'Messages', href: '/parent/dashboard/messages', icon: 'messages' },
  { label: 'Demo classes', href: '/parent/dashboard/demos', icon: 'demos' },
  { label: 'Hired tutors', href: '/parent/dashboard/hired-tutors', icon: 'hired' },
  { label: 'My children', href: '/parent/dashboard/children', icon: 'profile' },
  { label: 'Notifications', href: '/account/notifications', icon: 'bell' },
  { label: 'Browse tutors', href: '/browse/tutors', icon: 'browse' },
  { label: 'Packages', href: '/parent/packages', icon: 'package' },
  // Was /parent/verify — the verification flow, which is a one-way
  // submission and not where somebody goes to fix a mistyped city.
  { label: 'Settings', href: '/parent/dashboard/settings', icon: 'settings', separated: true },
]

/**
 * The menu for this member.
 *
 * `publicProfileSlug` adds the tutor's "My Profile (public view)" entry, and is
 * omitted when they have no slug yet — a menu item that 404s is worse than one
 * that is not there.
 *
 * `adminScreens` is already filtered by SCREEN_ACCESS by the caller, so a
 * verifier never sees Payments here even though the entry exists in the nav.
 */
export function menuForRole({
  role,
  publicProfileSlug = null,
  adminScreens = [],
}: {
  role: Role | null
  publicProfileSlug?: string | null
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
    ]
  }

  if (role === 'tutor') {
    const items = [...TUTOR]
    if (publicProfileSlug) {
      // Placed next to Messages rather than at the end: "how do parents see
      // me" is a question tutors ask constantly, and burying it under Settings
      // is how it stops being found.
      items.splice(4, 0, {
        label: 'My Profile',
        href: `/tutor/${publicProfileSlug}`,
        icon: 'profile',
      })
    }
    return items
  }

  return PARENT
}
