// lib/reauth.ts
//
// Re-authentication for destructive admin actions.
//
// The threat is an admin session left open — a shared laptop, a browser at an
// internet cafe, a phone handed to somebody. Supabase sessions are long-lived
// by design, which is right for a tutor and wrong for the account that can
// delete users and approve money.
//
// The obvious fix is a short admin session. It is also the wrong one: a
// moderator working a queue would be logged out every twenty minutes, and the
// predictable result is that the queue stops being worked. Shortening the
// session punishes the diligent admin and inconveniences the attacker for
// twenty minutes.
//
// So the session stays, and the SPECIFIC actions that cannot be undone ask for
// the password again if the last confirmation is more than 12 hours old:
//
//   * suspending or reinstating a member
//   * creating staff or changing an admin role
//   * deleting junk accounts
//   * approving or rejecting a payment
//
// Everything else — reading a queue, approving a video, resolving a report — is
// reversible and is not gated. A prompt on every action is a prompt people
// learn to type through without reading.

import { createAdminClient } from '@/lib/supabase/admin'

export const REAUTH_WINDOW_MS = 12 * 60 * 60 * 1000

export type ReauthCheck =
  | { ok: true }
  | { ok: false; response: Response }

/**
 * Is this admin's password confirmation still fresh?
 *
 * Returns a ready-made 401 carrying `reauth: true`, which is what the admin UI
 * watches for to raise the password prompt. It is deliberately a distinct
 * signal from an ordinary 401: "sign in again" and "confirm it is you" are
 * different requests, and conflating them sends the admin to the login page for
 * a session that is perfectly valid.
 */
export async function requireFreshAuth(userId: string): Promise<ReauthCheck> {
  const admin = createAdminClient()
  if (!admin) {
    return {
      ok: false,
      response: Response.json(
        { error: 'The server is not configured to verify this.' },
        { status: 500 },
      ),
    }
  }

  const { data } = await admin
    .from('profiles')
    .select('last_reauth_at')
    .eq('id', userId)
    .maybeSingle()

  const last = data?.last_reauth_at ? new Date(data.last_reauth_at as string).getTime() : 0

  if (Date.now() - last < REAUTH_WINDOW_MS) return { ok: true }

  return {
    ok: false,
    response: Response.json(
      {
        error: 'Confirm your password to continue.',
        reauth: true,
      },
      { status: 401 },
    ),
  }
}

/** Called after a successful password re-entry. */
export async function stampReauth(userId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('profiles').update({ last_reauth_at: new Date().toISOString() }).eq('id', userId)
}
