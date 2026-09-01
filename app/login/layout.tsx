import type { Metadata } from 'next'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//
// Not indexed. A sign-in page ranking for a brand name pushes the pages
// that actually answer a search further down.
export const metadata: Metadata = {
  title: 'Sign in | TutorMint',
  description: 'Sign in to TutorMint with your email address or mobile number.',
  robots: { index: false, follow: true },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
