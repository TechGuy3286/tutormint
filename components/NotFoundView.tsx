import ErrorShell from '@/components/ErrorShell'

// The body of a 404, shared by the two files that can serve one.
//
// Also where a tutor slug lands when the profile exists but may not be shown:
// a suspended tutor and a made-up URL are answered identically and on purpose.
// "That profile is suspended" would confirm the account exists and invite a
// guess at why, which is nobody's business but theirs and ours.
export default function NotFoundView() {
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
