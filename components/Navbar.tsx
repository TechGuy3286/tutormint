import { headers } from 'next/headers'
import Link from 'next/link'

import NotificationBell from '@/components/notifications/NotificationBell'
import UserMenu from '@/components/UserMenu'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { getSessionUser } from '@/lib/auth'
import { unreadCount } from '@/lib/notificationFeed'
import { createAdminClient } from '@/lib/supabase/admin'
import { menuForRole, type AdminEntry } from '@/lib/userMenu'

// The site header. A SERVER component, deliberately.
//
// It used to be a client component that fetched the user in useEffect, which
// meant every page rendered "signed out" and then corrected itself a beat
// later. On a header whose whole job is to say Login or Dashboard, that flash
// tells a signed-in member they are signed out. The same reasoning now covers
// the unread badge: a count that appears late reads as a notification that has
// only just arrived.
//
// WHAT THIS COSTS, stated plainly. Reading the session reads cookies, and a
// cookies() read in a component the root layout renders opts every route in the
// app out of static prerendering — including the homepage and the legal pages.
// Two things make that an acceptable trade rather than a regression:
//
//   * proxy.ts already calls supabase.auth.getUser() on every non-asset
//     request, homepage included. The auth round trip was being paid on each of
//     those hits already; what is new is an RSC render of pages that are small.
//   * getSessionUser() is React-cache()d, so the header, the area layout and
//     the page share one auth call and one profiles read per request. An
//     anonymous visitor stops at getUser() returning null and never reads
//     profiles or notifications at all.
//
// The way to have both is cacheComponents (Next 16's PPR) with the header in a
// Suspense boundary: a static shell with a dynamic hole. That flag changes
// caching semantics for the whole application and belongs in its own change.
// It is on the T8b list.

/** The admin screens this actor may actually open, for their menu. */
async function adminScreensFor(): Promise<AdminEntry[]> {
  const actor = await getAdminActor()
  if (!actor) return []

  // The same SCREEN_ACCESS entries the nav and every guard read. Listing them
  // again here with different rules is how a verifier ends up with a Payments
  // link that refuses them — the menu must never offer a door that is locked.
  const candidates: { label: string; href: string; allowed: (typeof SCREEN_ACCESS)['tutors'] }[] = [
    { label: 'Tutor moderation', href: '/admin/tutors', allowed: SCREEN_ACCESS.tutors },
    { label: 'Parent verification', href: '/admin/parents', allowed: SCREEN_ACCESS.parents },
    { label: 'Payments', href: '/admin/payments', allowed: SCREEN_ACCESS.payments },
    { label: 'Reports', href: '/admin/reports', allowed: SCREEN_ACCESS.reports },
    { label: 'Members', href: '/admin/users', allowed: SCREEN_ACCESS.users },
  ]

  return candidates
    .filter((c) => roleSatisfies(actor.adminRole, c.allowed))
    .map(({ label, href }) => ({ label, href }))
}

export default async function Navbar() {
  // /admin renders its own bar — wordmark, role chip, notifications, exit and
  // sign out — so the site header would be the SAME FUNCTIONS TWICE, stacked,
  // costing ~148px before any content. One header, and admin keeps the one
  // that carries the role chip, because that is the piece admin work needs.
  // The path arrives from proxy.ts; a layout has no other way to know it.
  const path = (await headers()).get('x-tm-pathname') ?? ''
  if (path === '/admin' || path.startsWith('/admin/')) return null

  const session = await getSessionUser()

  if (!session) {
    return (
      <Shell>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
        >
          Login
        </Link>
      </Shell>
    )
  }

  const role = session.profile?.role ?? null
  const name = session.profile?.full_name ?? session.user.email?.split('@')[0] ?? 'there'

  // A tutor's own public profile is only worth linking to once they have a
  // slug; before that the entry would 404.
  let slug: string | null = null
  if (role === 'tutor') {
    const admin = createAdminClient()
    const { data } = admin
      ? await admin.from('tutor_profiles').select('slug').eq('id', session.user.id).maybeSingle()
      : { data: null }
    slug = (data?.slug as string | null) ?? null
  }

  const [unread, adminScreens] = await Promise.all([
    unreadCount(),
    role === 'admin' ? adminScreensFor() : Promise.resolve([]),
  ])

  const items = menuForRole({ role, publicProfileSlug: slug, adminScreens })

  // What to say when the panel is empty. A tutor's next useful step is being
  // findable; a parent's is finding somebody; an admin's is the queue they
  // came to work. Telling a manager that "notifications arrive when a tutor
  // applies to your job" is telling them about somebody else's product.
  const empty =
    role === 'tutor'
      ? {
          hint: 'Complete your profile to start appearing in searches — notifications arrive when parents apply, message or book a demo.',
          action: { label: 'Complete your profile', href: '/tutor/complete-profile' },
        }
      : role === 'admin'
        ? {
            hint: 'Your account has nothing waiting. Member reports and queues live in the admin panel.',
            action: { label: 'Open the admin panel', href: '/admin' },
          }
        : {
            hint: 'Notifications arrive when a tutor applies to your job, replies to you, or accepts a demo.',
            action: { label: 'Browse tutors', href: '/browse/tutors' },
          }

  return (
    <Shell>
      <NotificationBell initialUnread={unread} emptyHint={empty.hint} emptyAction={empty.action} />
      <UserMenu
        name={name}
        avatarUrl={session.profile?.avatar_url ?? null}
        userId={session.user.id}
        items={items}
      />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 shadow-xs sm:px-12">
      <Link href="/" className="flex shrink-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="TutorMint" className="h-11 w-auto object-contain sm:h-14" />
      </Link>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  )
}
