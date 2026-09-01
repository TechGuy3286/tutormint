import type { Metadata } from 'next'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//
// Not indexed: this page is only meaningful to somebody who was sent here
// after a specific tuition, and an empty review form is not a search result
// anybody wants.
export const metadata: Metadata = {
  title: 'Leave a review | TutorMint',
  robots: { index: false, follow: true },
}

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
