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

/**
 * Where a role belongs after signing in.
 *
 * There is NO silent 'parent' fallback (owner, 9 Sep). A missing or unknown role
 * means the account has no profile row — the exact failure the dropped
 * on_auth_user_created trigger caused — and quietly routing it to the parent
 * dashboard is how a tutor became a "parent account". An unrecognised role now
 * throws, so the broken state surfaces instead of being papered over. Every
 * caller here routes an AUTHENTICATED member, who must have a role by the time
 * they reach it. 'academy' is a parent account (CLAUDE.md), so it maps to parent.
 */
export function homeForRole(role: Role | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'tutor':
      return '/tutor/dashboard'
    case 'parent':
    case 'academy':
      return '/parent/dashboard'
    default:
      throw new Error(
        `homeForRole: missing or unknown role ${JSON.stringify(role)} — a role must be set before routing.`,
      )
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
