import Footer from '@/components/Footer'
import Navbar from '@/components/Navbar'
import PreviewBanner from '@/components/PreviewBanner'

// The public site's chrome: header, preview strip, main, footer.
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
// because the tree says so, not because a component guessed from a header.
// Navbar, Footer and PreviewBanner no longer read the path at all.
//
// It is also used directly by app/not-found.tsx, which handles URLs that match
// no route: that file renders inside the ROOT layout, outside every group, so
// it has to bring its own chrome.
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <PreviewBanner />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  )
}
