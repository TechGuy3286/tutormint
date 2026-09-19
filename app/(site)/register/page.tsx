import { redirectIfSignedIn } from '@/lib/auth'
import { defaultRegisterRole } from '@/lib/authRoutes'

import RegisterForm from './RegisterForm'

// The single registration page. /tutor/register is a server redirect here,
// kept because tutor referral links (?ref=) carry that path.
//
// A SERVER COMPONENT that reads `next` and hands it to the client form. The
// obvious alternative — useSearchParams() inside the form — forces a Suspense
// boundary, and everything inside that boundary drops out of the server-
// rendered HTML: the page ships as the word "Loading…" and the form only
// appears once JavaScript has run. On the platform's main conversion page,
// reached largely over Pakistani mobile connections, that is a blank card in
// place of a signup form. Reading the parameter here costs nothing and the
// markup arrives complete.
//
// `next` carries a guest's interrupted action — the AuthGateModal journey —
// through signup AND through the phone gate, so they land back on the thing
// they were trying to do rather than on a dashboard.

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; role?: string }>
}) {
  const { next, role } = await searchParams
  // Somebody with a session is not creating an account. Before this they saw
  // the form, filled it in and were told the mobile number was already taken --
  // by themselves.
  await redirectIfSignedIn(next)
  // Tutor by default; the parent card starts checked only when a parent action
  // sent them here (owner PR33 §3). Decided on the server so the checked radio
  // is in the shipped HTML — the page is the platform's main conversion surface
  // and must not depend on JS to show the right default.
  const initialRole = defaultRegisterRole(role, next)
  return <RegisterForm next={next} initialRole={initialRole} />
}
