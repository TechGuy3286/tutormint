// lib/auth.ts
//
// The single place server components and route handlers ask "who is this?".
// Auth truth is the Supabase cookie session -- never localStorage or
// sessionStorage.

import { createClient } from '@/lib/supabase/server'

export type Role = 'tutor' | 'parent' | 'academy' | 'admin'

export type SessionProfile = {
  id: string
  role: Role
  account_type: string | null
  full_name: string | null
  email: string | null
  city: string | null
  avatar_url: string | null
  profile_completion: number | null
  cnic_verified_at: string | null
  address_verified_at: string | null
  /** Set by the reports queue or the member page. Gates the dashboards. */
  is_suspended: boolean | null
  suspension_reason: string | null
  admin_role: string | null
}

export type SessionUser = {
  user: { id: string; email: string | null }
  profile: SessionProfile | null
}

/**
 * Returns the signed-in user and their profile row, or null when there is no
 * session. Null-safe: a missing or unreadable profile yields
 * `{ user, profile: null }` rather than throwing, so callers can distinguish
 * "not signed in" (null) from "signed in but profile not set up yet".
 *
 * One round trip beyond the auth check: getUser() validates the JWT with the
 * auth server, then a single select on profiles.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, role, account_type, full_name, email, city, avatar_url, profile_completion, cnic_verified_at, address_verified_at, is_suspended, suspension_reason, admin_role',
    )
    .eq('id', user.id)
    .maybeSingle()

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: (profile as SessionProfile | null) ?? null,
  }
}

/** Where a role belongs after signing in. */
export function homeForRole(role: Role | null | undefined): string {
  switch (role) {
    case 'admin':
      // /admin is the dashboard. The old '/admin/dashboard' was a 404: no such
      // route has ever existed, so every admin sign-in landed on a broken page.
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
export function nextForRole(next: string | null | undefined, role: Role | null | undefined): string | null {
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
  return area === role ? next : null
}
