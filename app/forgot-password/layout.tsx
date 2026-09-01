import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Reset your password | TutorMint',
  robots: { index: false, follow: true },
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
