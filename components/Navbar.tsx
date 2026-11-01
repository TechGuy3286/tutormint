'use client'

import Image from 'next/image'
import Link from 'next/link'
import { SITE_LOGO_PATH } from '@/lib/siteIdentity'
import AuthCTA from '@/components/AuthCTA'
import NotificationBell from '@/components/notifications/NotificationBell'
import UserMenu from '@/components/UserMenu'
import MemberHeader from '@/components/MemberHeader'
import { useHeaderSession } from '@/components/session/HeaderSessionProvider'
import { dashboardHrefFor, emptyNotificationsFor, isMemberRole } from '@/lib/headerSessionCore'

// The site header (push 3, owner 1 Nov 2026).
//
// It was a server component that read the session cookie, so that the first
// paint already said Login or Dashboard. The price was that EVERY public page
// rendered per request: a cookies() read in something the root layout renders
// makes the whole app dynamic. Public pages are now cached at the CDN, so the
// header renders as a guest on the server and the signed-in part arrives from
// HeaderSessionProvider:
//
//   * a visitor with no sign-in cookie is a guest, decided in the browser with
//     no request — the Join free / Login buttons never move;
//   * a signed-in visitor sees an empty right-hand side for a moment (decided
//     before paint, so the guest buttons never flash), then their avatar,
//     messages, bell, Settings and Logout from /api/session/header.
//
// It still does not ask whether it is under /admin: the header is rendered by
// app/(site)/layout.tsx and admin sits outside that group (components/SiteChrome).
export default function Navbar() {
  const state = useHeaderSession()

  if (state.status === 'guest') {
    return (
      <Shell>
        <AuthCTA />
      </Shell>
    )
  }
  if (state.status === 'checking') {
    // Holds the row's height while the signed-in part loads; no guest buttons.
    return (
      <Shell>
        <span aria-hidden className="block h-11 w-24" />
      </Shell>
    )
  }

  const s = state.session
  const empty = emptyNotificationsFor(s.role)
  if (isMemberRole(s.role)) {
    return (
      <Shell member>
        <MemberHeader
          role={s.role}
          name={s.name}
          avatarUrl={s.avatarUrl}
          gender={s.gender}
          userId={s.userId}
          messagesUnread={s.messagesUnread}
          unread={s.unread}
          empty={empty}
        />
      </Shell>
    )
  }
  return (
    <Shell>
      <NotificationBell userId={s.userId} initialUnread={s.unread} emptyHint={empty.hint} emptyAction={empty.action} />
      <UserMenu name={s.name} avatarUrl={s.avatarUrl} dashboardHref={dashboardHrefFor(s.role)} items={s.items} />
    </Shell>
  )
}

function Shell({ children, member = false }: { children: React.ReactNode; member?: boolean }) {
  // The member header has six controls on the right; below 400px the logo and
  // the gaps shrink so they fit one row at 320px. Every other header keeps the
  // sizes it always had.
  return (
    <header
      className={`sticky top-0 z-50 flex items-center justify-between border-b border-gray-200 bg-white py-3 shadow-xs sm:px-12 ${
        member ? 'gap-2 px-3 min-[360px]:px-4 sm:gap-3' : 'gap-3 px-4'
      }`}
    >
      <Link href="/" className="flex shrink-0 items-center">
        {/* next/image: the logo is a 2048x752 PNG drawn at 153px wide, so it is
            resized and re-encoded to a few KB; `priority` because it is above
            the fold on every page. */}
        <Image
          src={SITE_LOGO_PATH}
          alt="TutorMint"
          width={2048}
          height={752}
          priority
          sizes="(min-width: 640px) 153px, 120px"
          className={
            member
              ? 'h-8 w-[72px] object-contain min-[360px]:h-9 min-[360px]:w-[88px] min-[400px]:h-11 min-[400px]:w-[120px] sm:h-14 sm:w-[153px]'
              : // Below 360px the logo steps down so "Join free" and "Login" fit
                // one row beside it at 320px (owner, 15 Oct 2026).
                'h-9 w-[96px] object-contain min-[360px]:h-11 min-[360px]:w-[120px] sm:h-14 sm:w-[153px]'
          }
        />
      </Link>
      <div className={`flex shrink-0 items-center ${member ? 'gap-0.5 min-[400px]:gap-1 sm:gap-2' : 'gap-2'}`}>
        {children}
      </div>
    </header>
  )
}
