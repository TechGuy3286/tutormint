import type { Metadata } from 'next'

import NotFoundView from '@/components/NotFoundView'

// notFound() thrown by any page in the site group. The header, preview strip
// and footer come from app/(site)/layout.tsx, so this file is the body only.
// app/not-found.tsx is the same page for an unmatched URL and wraps itself.

export const metadata: Metadata = {
  title: 'Page not found | TutorMint',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return <NotFoundView />
}
