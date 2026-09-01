import type { Metadata } from 'next'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//

export const metadata: Metadata = {
  title: 'Create your account | TutorMint',
  description:
    'Join TutorMint as a tutor, a parent, or a school or academy. Browsing is free — an account is only needed to apply, post or message.',
  robots: { index: false, follow: true },
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
