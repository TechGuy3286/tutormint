import type { Metadata } from 'next'
import { pageTitle } from '@/lib/seo'

// Personal / signed-in pages stay dynamic (push 3, owner 1 Nov 2026). They
// used to be dynamic only because the site header read the sign-in cookie;
// the header is now in the browser, so this says it on purpose.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: pageTitle('Reset your password'),
  robots: { index: false, follow: true },
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
