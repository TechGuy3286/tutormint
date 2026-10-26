import 'server-only'

import { cookies } from 'next/headers'
import { createClient as createPlainClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import type { AdminRole } from '@/lib/adminAccessCore'
import {
  makeTicket,
  readTicket,
  sessionIdOf,
  VIEW_AS_COOKIE,
  VIEW_AS_EXIT_PATH,
  VIEW_AS_MS,
  VIEW_AS_OWNER_COOKIE,
  VIEW_AS_UI_COOKIE,
  viewAsHome,
} from '@/lib/viewAsCore'

// "View as" (owner, 26 Oct 2026; rules lib/viewAsCore). Server half.
//
// Start: the Owner's own refresh token is kept in a cookie sent only to the
// exit route; a session for the member is minted with an admin magic-link token
// (no password, no code ever shown) and put in the browser's session cookies;
// the session's id goes in view_as_sessions, which the database reads to refuse
// every write made with it; a signed ticket (30 minutes) goes in tm_view_as.
// Exit (or the 30 minutes running out): the minted session is removed, the
// Owner's own session is put back, and both ends are in Audit.

type Actor = { id: string; adminRole: AdminRole; email: string | null }

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? null
const COOKIE_BASE = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const }
// The ticket's cookie outlives the 30 minutes on purpose: a browser that comes
// back later still carries it, and the proxy then ends the session.
const COOKIE_MAX_AGE = 12 * 60 * 60

export async function startViewAs(actor: Actor, memberId: string): Promise<{ ok: true; redirect: string } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  const key = secret()
  if (!admin || !key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data: member } = await admin.from('profiles').select('id, role, full_name, merged_into').eq('id', memberId).maybeSingle()
  if (!member || !['tutor', 'parent', 'academy'].includes(member.role as string)) return { ok: false, status: 404, error: 'Only a tutor or parent can be viewed.' }
  if (member.merged_into) return { ok: false, status: 409, error: 'This account was merged into another.' }

  // The Owner's own session, to put back on Exit.
  const supabase = await createClient()
  const {
    data: { session: own },
  } = await supabase.auth.getSession()
  if (!own?.refresh_token) return { ok: false, status: 401, error: 'Please sign in again.' }

  // A session for the member — no password and no code is ever seen.
  const { data: au } = await admin.auth.admin.getUserById(memberId)
  const email = au?.user?.email
  if (!email) return { ok: false, status: 400, error: 'This account has no sign-in address.' }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) return { ok: false, status: 500, error: 'The view could not start. Please try again.' }
  const plain = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: minted, error: vErr } = await plain.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  const ms = minted?.session
  const sessionId = ms ? sessionIdOf(ms.access_token) : null
  if (vErr || !ms || !sessionId) return { ok: false, status: 500, error: 'The view could not start. Please try again.' }

  const expiresAt = Date.now() + VIEW_AS_MS
  const { data: row, error: insErr } = await admin
    .from('view_as_sessions')
    .insert({ owner_id: actor.id, member_id: memberId, session_id: sessionId, expires_at: new Date(expiresAt).toISOString() })
    .select('id')
    .single()
  if (insErr || !row) {
    await admin.rpc('end_view_as_session', { p_session_id: sessionId })
    return { ok: false, status: 500, error: 'The view could not start. Please try again.' }
  }

  // Swap the browser's session for the member's (the cookie client writes it).
  const { error: setErr } = await supabase.auth.setSession({ access_token: ms.access_token, refresh_token: ms.refresh_token })
  if (setErr) {
    await admin.rpc('end_view_as_session', { p_session_id: sessionId })
    await admin.from('view_as_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'failed' }).eq('id', row.id)
    return { ok: false, status: 500, error: 'The view could not start. Please try again.' }
  }
  const jar = await cookies()
  jar.set(VIEW_AS_COOKIE, makeTicket({ id: row.id as string, expiresAt }, key), { ...COOKIE_BASE, path: '/', maxAge: COOKIE_MAX_AGE })
  jar.set(VIEW_AS_OWNER_COOKIE, own.refresh_token, { ...COOKIE_BASE, path: VIEW_AS_EXIT_PATH, maxAge: COOKIE_MAX_AGE })
  jar.set(VIEW_AS_UI_COOKIE, '1', { secure: COOKIE_BASE.secure, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE })

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.view_as_start',
    targetType: 'profile',
    targetId: memberId,
    detail: { viewId: row.id, minutes: VIEW_AS_MS / 60_000 },
  })
  return { ok: true, redirect: viewAsHome(member.role as string) }
}

/** End the view: the minted session removed, the Owner's session put back. */
export async function exitViewAs(reason: 'exit' | 'expired'): Promise<{ redirect: string }> {
  const admin = createAdminClient()
  const jar = await cookies()
  const ticket = readTicket(jar.get(VIEW_AS_COOKIE)?.value, secret())
  const ownerRefresh = jar.get(VIEW_AS_OWNER_COOKIE)?.value ?? null
  const clear = () => {
    jar.set(VIEW_AS_COOKIE, '', { ...COOKIE_BASE, path: '/', maxAge: 0 })
    jar.set(VIEW_AS_OWNER_COOKIE, '', { ...COOKIE_BASE, path: VIEW_AS_EXIT_PATH, maxAge: 0 })
    jar.set(VIEW_AS_UI_COOKIE, '', { path: '/', maxAge: 0 })
  }
  if (!ticket || !admin) {
    clear()
    return { redirect: '/login' }
  }
  const { data: row } = await admin.from('view_as_sessions').select('id, owner_id, member_id, session_id, ended_at').eq('id', ticket.id).maybeSingle()
  const supabase = await createClient()
  if (row?.session_id) await admin.rpc('end_view_as_session', { p_session_id: row.session_id as string })
  // Put the Owner's own session back; if it cannot be, they sign in again.
  let restored = false
  if (ownerRefresh) {
    const { error } = await supabase.auth.refreshSession({ refresh_token: ownerRefresh })
    restored = !error
  }
  if (!restored) await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
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
  return { redirect: restored ? back : `/login?next=${encodeURIComponent(back)}` }
}

/** The banner's facts for this request, or null when not viewing. */
export async function currentViewAs(): Promise<{ name: string; expiresAt: number } | null> {
  const jar = await cookies()
  const ticket = readTicket(jar.get(VIEW_AS_COOKIE)?.value, secret())
  if (!ticket) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data: row } = await admin.from('view_as_sessions').select('member_id, ended_at').eq('id', ticket.id).maybeSingle()
  if (!row || row.ended_at) return null
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', row.member_id as string).maybeSingle()
  return { name: formatName((p?.full_name as string | null) ?? null) || 'this member', expiresAt: ticket.expiresAt }
}

/** The 5-minute cron: end every view whose 30 minutes ran out (the browser
 *  may never come back). Returns how many were ended. */
export async function endExpiredViews(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { data } = await admin.from('view_as_sessions').select('id, owner_id, member_id, session_id').is('ended_at', null).lt('expires_at', new Date().toISOString())
  let n = 0
  for (const r of data ?? []) {
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
