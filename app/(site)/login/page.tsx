import { redirectIfSignedIn } from '@/lib/auth'

import LoginForm from './LoginForm'

// The single sign-in page. /parent/login and /tutor/login redirect here.
//
// A SERVER COMPONENT that does two things before the form renders:
//
//   1. Sends a signed-in member to where they belong. Showing the sign-in form
//      to somebody who already has a session is what produced the stuck
//      button: they submitted it, the credentials were accepted, and the
//      router was asked to move to a page they were already on the way to --
//      and when that move did not take, "SIGNING IN…" was all that was left.
//      The form is now unreachable with a session.
//
//   2. Reads `next` and hands it to the form. The alternative,
//      useSearchParams() inside the form, forces a Suspense boundary and
//      everything inside one drops out of the server-rendered HTML -- the page
//      would ship as the word "Loading…" over a Pakistani mobile connection
//      and the form would appear only once JavaScript had run.

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  await redirectIfSignedIn(next)
  return <LoginForm next={next ?? null} />
}
