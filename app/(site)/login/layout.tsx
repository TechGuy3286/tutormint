import type { Metadata } from 'next'
import { pageTitle, socialMeta } from '@/lib/seo'

// Metadata for a client-component page.
//
// A page marked 'use client' cannot export `metadata` — Next reads it during
// the server render and the export does not exist there. A layout wrapping the
// single route can, which is why this file is one line of JSX and a title.
//
// Not indexed. A sign-in page ranking for a brand name pushes the pages
// that actually answer a search further down.
// Personal / signed-in pages stay dynamic (push 3, owner 1 Nov 2026). They
// used to be dynamic only because the site header read the sign-in cookie;
// the header is now in the browser, so this says it on purpose.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: pageTitle('Sign in'),
  description: 'Sign in to TutorMint with your email address or mobile number.',
  robots: { index: false, follow: true },
  // The link preview (owner, 21 Oct 2026). Every signed-in-only page a WhatsApp
  // message links to (/pay/choose, /tutor/dashboard) sends a signed-out visitor
  // — and WhatsApp's preview fetcher — here, so this is what those links show:
  // a clear TutorMint "Sign in" card with the logo, not the generic site card.
  ...socialMeta({
    title: 'Sign in to TutorMint',
    description: 'Sign in to your TutorMint account to continue — your profile, tuitions and payments.',
    path: '/login',
  }),
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
