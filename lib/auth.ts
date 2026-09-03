// lib/auth.ts
//
// The single place server components and route handlers ask "who is this?".
// Auth truth is the Supabase cookie session -- never localStorage or
// sessionStorage.

import { cache } from 'react'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { homeForRole, nextForRole } from '@/lib/authRoutes'

export type { Role } from '@/lib/authRoutes'
import type { Role } from '@/lib/authRoutes'

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
 *
 * Wrapped in React's cache(), which dedupes it for the lifetime of ONE render.
 * A dashboard page already called this twice -- once in the layout to gate the
 * area, once in the page to draw it -- and the header now asks a third time on
 * every route in the app. cache() collapses those into a single auth round trip
 * and a single profiles read per request. It is per-request memoisation, not a
 * cross-request cache: two visitors never share an answer, which for a function
 * that returns "who is signed in" is the only acceptable behaviour.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
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
})

// The pure routing helpers live in lib/authRoutes.ts so the login page can
// import them without pulling next/headers into the browser bundle. Re-exported
// here so server callers still have one import.
export { homeForRole, nextForRole } from '@/lib/authRoutes'

/**
 * Send a signed-in member away from an auth page.
 *
 * /login, /register and /forgot-password are for people who do not have a
 * session, and until now they rendered their form to people who did. Submitting
 * that form is the bug this closes: the sign-in succeeded, the router was asked
 * to move to a page the member was already entitled to, and when that move did
 * not take there was nothing on screen but "SIGNING IN…". A member who is
 * already signed in should never be shown the form at all.
 *
 * Honours `?next=` through nextForRole, so an interrupted action still
 * completes -- a guest who signed in in another tab and came back to a stale
 * /login?next=/parent/dashboard/job/x lands on the job, not on a dashboard.
 *
 * Signing out is unaffected: it clears the session first, so the next visit to
 * /login has nothing to redirect.
 */
export async function redirectIfSignedIn(next?: string | null): Promise<void> {
  const session = await getSessionUser()
  if (!session) return
  const role = (session.profile?.role as Role | null) ?? null
  redirect(nextForRole(next, role) ?? homeForRole(role))
}
