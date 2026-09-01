import type { Metadata } from 'next'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//

export const metadata: Metadata = {
  title: 'Blog | TutorMint',
  description:
    'Guidance for tutors and parents in Pakistan: choosing a tutor, fees, exam preparation and getting hired.',
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
