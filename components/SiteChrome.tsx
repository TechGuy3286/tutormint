import Footer from '@/components/Footer'
import Navbar from '@/components/Navbar'
import MessagesDock from '@/components/messages/MessagesDock'
import SupportWhatsApp from '@/components/support/SupportWhatsApp'
import { getSessionUser } from '@/lib/auth'
import { unreadMessageCount } from '@/lib/messaging'
import { supportContactFromEnv, whatsappHref } from '@/lib/support'

// The public site's chrome: header, main, footer — plus (PR 4) the desktop
// messages dock and the floating WhatsApp support button.
//
// The "launching soon" preview strip was removed on 9 Sep 2026 — the site
// presents as live. See "Preview banner removed" in CLAUDE.md.
//
// WHY IT IS NOT IN THE ROOT LAYOUT ANY MORE. It was, and each of the three
// pieces asked `headers().get('x-tm-pathname')` whether it was under /admin and
// returned null if so. That check is correct on a full page load and WRONG on
// every client navigation after one: a root layout is rendered once and is not
// re-rendered when the route below it changes, so pressing "Back to site" from
// /admin/tutors landed on a homepage with no header, no banner and no footer
// until the visitor reloaded. The header had been told the path was /admin and
// nothing ever told it otherwise.
//
// The fix is structural rather than a fresher path read. app/(site) is a route
// group whose layout renders this; app/admin sits outside that group with its
// own shell. Navigating between them enters and leaves a layout segment, which
// is a thing the router does re-render — so the chrome appears and disappears
// because the tree says so, not because a component guessed from a header. This
// is also why the dock and the WhatsApp button live HERE and not in the root
// layout: mounted in the (site) group they are ABSENT from /admin by
// construction (§2.5, §4.4), with no path guessing.
//
// It is also used directly by app/not-found.tsx, which handles URLs that match
// no route: that file renders inside the ROOT layout, outside every group, so
// it has to bring its own chrome.
export default async function SiteChrome({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser() // React-cache()d — shared with Navbar.
  const role = session?.profile?.role ?? null
  const isMember = (role === 'tutor' || role === 'parent') && !!session

  // Env-only + the one constant, so there is no DB read here (a cookies() read in
  // the chrome would make every page dynamic — see lib/support.ts).
  const supportHref = whatsappHref(
    supportContactFromEnv().whatsapp,
    'Assalam-o-Alaikum, I need some help with TutorMint.',
  )
  const dockUnread = isMember ? await unreadMessageCount(session.user.id) : 0
  const dockRole = role === 'tutor' ? 'tutor' : 'parent'
  const basePath = role === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages'

  return (
    <>
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      {isMember && (
        <MessagesDock role={dockRole} basePath={basePath} initialUnread={dockUnread} supportHref={supportHref} />
      )}
      <SupportWhatsApp href={supportHref} signedIn={!!session} />
    </>
  )
}
