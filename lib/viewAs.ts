import 'server-only'

import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'

import { createRealClient } from '@/lib/supabase/serverReal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAccessCore'
import { getViewAsContext } from '@/lib/viewAsContext'
import { makeTicket, readTicket, VIEW_AS_COOKIE, VIEW_AS_EXIT_PATH, VIEW_AS_MS, VIEW_AS_OWNER_COOKIE, VIEW_AS_UI_COOKIE, viewAsHome } from '@/lib/viewAsCore'

// "View as" (owner, 26 Oct 2026; reworked 27 Oct 2026 — rules lib/viewAsCore,
// lib/viewAsGuardCore; who-is-this lib/viewAsContext). Server half.
//
// Start: a view_as_sessions row (30 minutes) and a signed ticket in tm_view_as.
// NOBODY is signed in as the member: the Owner keeps their own session, the
// server reads the member's data with the service role and answers "who is
// this?" with the member, and every write is refused. The member's last
// sign-in never moves and their activity is never recorded (the activity
// beacon is a POST, refused by proxy.ts).
// Exit (or the 30 minutes running out): the row is ended, the cookies cleared,
// and both ends are in Audit and on the member's Activity tab.

type Actor = { id: string; adminRole: AdminRole; email: string | null }

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? null
const COOKIE_BASE = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const }
// The ticket's cookie outlives the 30 minutes on purpose: a browser that comes
// back later still carries it, and the proxy then ends the view.
const COOKIE_MAX_AGE = 12 * 60 * 60

export async function startViewAs(actor: Actor, memberId: string): Promise<{ ok: true; redirect: string } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  const key = secret()
  if (!admin || !key) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data: member } = await admin.from('profiles').select('id, role, merged_into').eq('id', memberId).maybeSingle()
  if (!member || !['tutor', 'parent', 'academy'].includes(member.role as string)) return { ok: false, status: 404, error: 'Only a tutor or parent can be viewed.' }
  if (member.merged_into) return { ok: false, status: 409, error: 'This account was merged into another.' }

  const expiresAt = Date.now() + VIEW_AS_MS
  // session_id is a fresh random id that no real session has — the view signs
  // nobody in (the column is unique and was the minted session's id before).
  const { data: row, error: insErr } = await admin
    .from('view_as_sessions')
    .insert({ owner_id: actor.id, member_id: memberId, session_id: randomUUID(), expires_at: new Date(expiresAt).toISOString() })
    .select('id')
    .single()
  if (insErr || !row) return { ok: false, status: 500, error: 'The view could not start. Please try again.' }

  const jar = await cookies()
  jar.set(VIEW_AS_COOKIE, makeTicket({ id: row.id as string, expiresAt }, key), { ...COOKIE_BASE, path: '/', maxAge: COOKIE_MAX_AGE })
  // Readable by the browser client: the member's id, so client components ask
  // for the member's rows; every browser write is refused too.
  jar.set(VIEW_AS_UI_COOKIE, memberId, { secure: COOKIE_BASE.secure, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE })

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.view_as_start',
    targetType: 'profile',
    targetId: memberId,
    detail: { viewId: row.id, minutes: VIEW_AS_MS / 60_000, signedIn: false },
  })
  return { ok: true, redirect: viewAsHome(member.role as string) }
}

/** End the view. The Owner's own session was never replaced, so there is
 *  nothing to put back (a view started before 27 Oct still has a minted
 *  session and the Owner's refresh token — both are handled). */
export async function exitViewAs(reason: 'exit' | 'expired'): Promise<{ redirect: string }> {
  const admin = createAdminClient()
  const jar = await cookies()
  const ticket = readTicket(jar.get(VIEW_AS_COOKIE)?.value, secret())
  const legacyOwnerRefresh = jar.get(VIEW_AS_OWNER_COOKIE)?.value ?? null
  const clear = () => {
    jar.set(VIEW_AS_COOKIE, '', { ...COOKIE_BASE, path: '/', maxAge: 0 })
    jar.set(VIEW_AS_OWNER_COOKIE, '', { ...COOKIE_BASE, path: VIEW_AS_EXIT_PATH, maxAge: 0 })
    jar.set(VIEW_AS_UI_COOKIE, '', { path: '/', maxAge: 0 })
  }
  if (!ticket || !admin) {
    clear()
    return { redirect: '/admin' }
  }
  const { data: row } = await admin.from('view_as_sessions').select('id, owner_id, member_id, session_id, ended_at').eq('id', ticket.id).maybeSingle()
  let signedOut = false
  if (legacyOwnerRefresh) {
    // A view started by the old flow: remove the member session it minted and
    // put the Owner's own session back.
    if (row?.session_id) await admin.rpc('end_view_as_session', { p_session_id: row.session_id as string })
    const supabase = await createRealClient()
    const { error } = await supabase.auth.refreshSession({ refresh_token: legacyOwnerRefresh })
    if (error) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      signedOut = true
    }
  }
  clear()
  if (row && !row.ended_at) {
    await admin.from('view_as_sessions').update({ ended_at: new Date().toISOString(), end_reason: reason }).eq('id', row.id as string)
    await logAdminAction({
      actorId: row.owner_id as string,
      actorRole: 'owner',
      actorEmail: null,
      action: 'member.view_as_end',
      targetType: 'profile',
      targetId: row.member_id as string,
      detail: { viewId: row.id, reason },
    })
  }
  const back = row ? `/admin/users/${row.member_id as string}` : '/admin'
  return { redirect: signedOut ? `/login?next=${encodeURIComponent(back)}` : back }
}

/** The banner's facts for this request, or null when not viewing. */
export async function currentViewAs(): Promise<{ name: string; expiresAt: number } | null> {
  const ctx = await getViewAsContext()
  return ctx ? { name: ctx.memberName, expiresAt: ctx.expiresAt } : null
}

/** The 5-minute cron: end every view whose 30 minutes ran out (the browser
 *  may never come back). Returns how many were ended. */
export async function endExpiredViews(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { data } = await admin.from('view_as_sessions').select('id, owner_id, member_id, session_id').is('ended_at', null).lt('expires_at', new Date().toISOString())
  let n = 0
  for (const r of data ?? []) {
    // Removes a minted session only for a view started by the old flow; a new
    // view's session_id matches no session, so this does nothing.
    await admin.rpc('end_view_as_session', { p_session_id: r.session_id as string })
    await admin.from('view_as_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'expired' }).eq('id', r.id as string)
    await logAdminAction({
      actorId: r.owner_id as string,
      actorRole: 'owner',
      actorEmail: null,
      action: 'member.view_as_end',
      targetType: 'profile',
      targetId: r.member_id as string,
      detail: { viewId: r.id, reason: 'expired' },
    })
    n++
  }
  return n
}
