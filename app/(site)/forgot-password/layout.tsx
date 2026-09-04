import type { Metadata } from 'next'
import { pageTitle } from '@/lib/seo'

export const metadata: Metadata = {
  title: pageTitle('Reset your password'),
  robots: { index: false, follow: true },
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
