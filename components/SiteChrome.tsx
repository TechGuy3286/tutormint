import Footer from '@/components/Footer'
import Navbar from '@/components/Navbar'
import HeaderSessionProvider from '@/components/session/HeaderSessionProvider'
import { GuestVisitBeacon, MemberDock, SessionBanner } from '@/components/session/SessionChromeBits'
import { getSupportContact, supportContactFromEnv, whatsappHref } from '@/lib/support'
import { getCompany } from '@/lib/company'
import { jsonLdScript, siteGraphJsonLd } from '@/lib/seo'
import StaffRefCapture from '@/components/StaffRefCapture'

// The public site's chrome: header, main, footer — plus (PR 4) the desktop
// messages dock. The floating WhatsApp support button was removed (PR21 — it
// overlapped content); the support number still appears in the footer, on
// /support, the FAQ, the auth "Need help?" links, the SMS "Contact support"
// line, the Messages dock's Support tab, and the Organization structured data.
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
// PUSH 3 (owner, 1 Nov 2026): IT NO LONGER READS THE SESSION. A cookies() read
// here made every public page render per request. Everything that depends on who
// is looking — the header's signed-in side, the View-as banner, the visit beacon,
// the messages dock and the footer's guest links — is decided in the browser by
// HeaderSessionProvider, so the page around it can be cached at the CDN.
export default async function SiteChrome({ children }: { children: React.ReactNode }) {
  // Env-only + the one constant, so there is no DB read here.
  const supportHref = whatsappHref(
    supportContactFromEnv().whatsapp,
    'Assalam-o-Alaikum, I need some help with TutorMint.',
  )
  // Organization + WebSite, ONCE on every public page (owner, 13 Oct 2026). The
  // legal facts and the support number come from app_settings (env fallback),
  // read with the cookie-free public client.
  const [company, support] = await Promise.all([getCompany(), getSupportContact()])

  return (
    <HeaderSessionProvider>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(siteGraphJsonLd(company, support.whatsapp))}
      />
      <SessionBanner />
      <Navbar />
      <GuestVisitBeacon />
      {/* A staff link (?ref=<code>) on any page: saved for 30 days, then taken
          out of the address bar (owner, 23 Oct 2026). */}
      <StaffRefCapture />
      <main className="flex-1">{children}</main>
      <Footer />
      <MemberDock supportHref={supportHref} />
    </HeaderSessionProvider>
  )
}
