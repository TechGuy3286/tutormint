// lib/authRoutes.ts
//
// The pure "where does this person belong" helpers, split out of lib/auth.ts
// so client components can import them.
//
// lib/auth.ts pulls in the Supabase server client, which reaches for
// next/headers and cannot be bundled for the browser. The login page needs
// exactly these two functions and nothing else, and having a second copy
// inside it is how the two drifted: the page routed admins to
// /admin/dashboard, a URL that has never existed, long after lib/auth.ts was
// fixed. One definition now, re-exported from lib/auth.ts for server callers.

export type Role = 'tutor' | 'parent' | 'academy' | 'admin'

/** Where a role belongs after signing in. */
export function homeForRole(role: Role | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'tutor':
      return '/tutor/dashboard'
    default:
      return '/parent/dashboard'
  }
}

/**
 * True when `next` is a safe same-origin path this role is allowed to land on.
 * Guards against open redirects (protocol-relative or absolute URLs) and stops
 * a parent being sent to a tutor page just because ?next= said so.
 */
export function nextForRole(
  next: string | null | undefined,
  role: Role | null | undefined,
): string | null {
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//')) return null

  const area = next.startsWith('/tutor')
    ? 'tutor'
    : next.startsWith('/parent')
      ? 'parent'
      : next.startsWith('/admin')
        ? 'admin'
        : null

  if (area === null) return next // a public page: anyone may be returned to it
  if (area === 'admin') return role === 'admin' ? next : null
  if (area === 'parent') return role === 'parent' || role === 'academy' ? next : null
  return area === role ? next : null
}
