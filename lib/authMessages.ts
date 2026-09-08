// Auth-flow copy that must be exact and is asserted by tests.
//
// The banned-login message is owner-locked, verbatim (Sunday 6 Sep): a banned
// account is refused at login with this and no session is created. It lives here
// rather than inline in the route so scripts/test-auth-trust.ts can pin the
// exact wording without importing the route (which pulls in next/headers).

export const BANNED_LOGIN_MESSAGE =
  'Your account has been banned due to fraudulent activities. Please contact support.'
