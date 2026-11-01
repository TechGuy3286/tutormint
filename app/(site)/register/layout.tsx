import type { Metadata } from 'next'
import { pageTitle } from '@/lib/seo'

// Metadata for /register.
//
// The page itself is now a server component (it reads `next` from
// searchParams), so it could carry this export. It stays here because the
// route's metadata has not changed and moving it would be churn — and because
// RegisterForm.tsx, which does the work, is still 'use client' and could never
// hold it.
//

// Personal / signed-in pages stay dynamic (push 3, owner 1 Nov 2026). They
// used to be dynamic only because the site header read the sign-in cookie;
// the header is now in the browser, so this says it on purpose.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: pageTitle('Create your account'),
  description:
    'Join TutorMint as a tutor, a parent, or a school or academy. Browsing is free — an account is only needed to apply, post or message.',
  robots: { index: false, follow: true },
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
