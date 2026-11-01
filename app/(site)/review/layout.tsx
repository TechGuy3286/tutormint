import type { Metadata } from 'next'
import { pageTitle } from '@/lib/seo'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//
// Not indexed: this page is only meaningful to somebody who was sent here
// after a specific tuition, and an empty review form is not a search result
// anybody wants.
// Personal / signed-in pages stay dynamic (push 3, owner 1 Nov 2026). They
// used to be dynamic only because the site header read the sign-in cookie;
// the header is now in the browser, so this says it on purpose.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: pageTitle('Leave a review'),
  robots: { index: false, follow: true },
}

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
