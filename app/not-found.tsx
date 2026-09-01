import type { Metadata } from 'next'
import ErrorShell from '@/components/ErrorShell'

// 404.
//
// Also where a tutor slug lands when the profile exists but may not be shown:
// a suspended tutor and a made-up URL are answered identically and on purpose.
// "That profile is suspended" would confirm the account exists and invite a
// guess at why, which is nobody's business but theirs and ours.

export const metadata: Metadata = {
  title: 'Page not found | TutorMint',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="We could not find that page"
      message="The link may be out of date, or the profile may no longer be listed. Everything else is still where you left it."
      actions={[
        { label: 'Find a tutor', href: '/browse/tutors' },
        { label: 'Find tuitions', href: '/browse/tuitions', tone: 'quiet' },
        { label: 'Go to the homepage', href: '/', tone: 'quiet' },
      ]}
    />
  )
}
