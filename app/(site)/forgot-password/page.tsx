import { redirectIfSignedIn } from '@/lib/auth'

import ForgotPasswordForm from './ForgotPasswordForm'

// Password reset. A server shell around the form, for one reason: a member who
// already has a session does not need to reset a password they can change from
// their settings, and rendering a signed-out flow to a signed-in person is the
// same class of bug as the sign-in form that could not finish.
//
// The form itself is unchanged and documents both paths (mobile code, email
// link) at the top of ForgotPasswordForm.tsx.

export default async function ForgotPasswordPage() {
  await redirectIfSignedIn()
  return <ForgotPasswordForm />
}
