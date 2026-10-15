// lib/headerAuth.ts
//
// PURE. Which signed-out header buttons show on a path (owner, 15 Oct 2026):
// "Join free" and "Login" on every public page, except the one that goes where
// the visitor already is. The Navbar renders these ONLY when there is no
// session, so a signed-in member never sees either.

const SIGNUP_PATHS = new Set(['/register', '/signup'])
const LOGIN_PATHS = new Set(['/login'])

export function headerAuthButtons(pathname: string): { join: boolean; login: boolean } {
  const path = (pathname || '/').replace(/\/+$/, '') || '/'
  return {
    join: !SIGNUP_PATHS.has(path),
    login: !LOGIN_PATHS.has(path),
  }
}
