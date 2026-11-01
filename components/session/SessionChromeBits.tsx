'use client'

import MessagesDock from '@/components/messages/MessagesDock'
import ViewAsBanner from '@/components/ViewAsBanner'
import VisitBeacon from '@/components/VisitBeacon'
import { useHeaderSession } from '@/components/session/HeaderSessionProvider'
import { isMemberRole, MESSAGES_BASE_PATH } from '@/lib/headerSessionCore'

// The parts of the site chrome that depend on who is looking (push 3, owner
// 1 Nov 2026), decided in the browser so the page around them can be cached.

/** "View as" (owner, 26 Oct 2026): the read-only banner while the Owner views a member. */
export function SessionBanner() {
  const state = useHeaderSession()
  if (state.status !== 'signed-in' || !state.session.viewAsName) return null
  return <ViewAsBanner name={state.session.viewAsName} />
}

/** Signed-out page views feed the daily sign-up funnel (owner, 15 Oct 2026). */
export function GuestVisitBeacon() {
  return useHeaderSession().status === 'guest' ? <VisitBeacon /> : null
}

/** The desktop messages dock, for tutors and parents. */
export function MemberDock({ supportHref }: { supportHref: string | null }) {
  const state = useHeaderSession()
  if (state.status !== 'signed-in' || !isMemberRole(state.session.role)) return null
  const role = state.session.role
  return (
    <>
      {/* Bottom padding equal to the collapsed dock bar's height, desktop only,
          so the fixed bar never sits over the footer's last links (PR5b §2.3). */}
      <div aria-hidden className="hidden h-12 lg:block" />
      <MessagesDock role={role} basePath={MESSAGES_BASE_PATH[role]} initialUnread={state.session.messagesUnread} supportHref={supportHref} />
    </>
  )
}

/** Shows its children to guests only — the footer's Sign up / Login links. */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  return useHeaderSession().status === 'guest' ? <>{children}</> : null
}
