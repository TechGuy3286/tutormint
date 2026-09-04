import type { Metadata } from 'next'

import NotFoundView from '@/components/NotFoundView'
import SiteChrome from '@/components/SiteChrome'

// The 404 for a URL that matches NO route at all.
//
// It renders inside the root layout and nothing else — it is outside app/(site)
// and outside every other group, so it is the one page that has to bring its
// own header and footer. A notFound() thrown from a page inside the site group
// lands on app/(site)/not-found.tsx instead, and gets the chrome from the
// layout like any other page there.

export const metadata: Metadata = {
  title: 'Page not found | TutorMint',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <SiteChrome>
      <NotFoundView />
    </SiteChrome>
  )
}
