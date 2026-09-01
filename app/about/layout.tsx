import type { Metadata } from 'next'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//
// About is a real search-engine surface: "is TutorMint legitimate" is a
// question people type before they trust a platform with a CNIC.
export const metadata: Metadata = {
  title: 'About TutorMint | Verified tutors across Pakistan',
  description:
    'TutorMint connects degree-verified tutors and teachers with parents, schools and academies across Pakistan. No commission — ever.',
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
