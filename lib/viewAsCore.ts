// lib/viewAsCore.ts — PURE apart from node:crypto. "View as" (owner, 26 Oct 2026).
//
// The Owner opens a member's dashboard exactly as they see it, read only, with
// a fixed banner "Viewing as <name> — read only · Exit". Reworked 27 Oct 2026:
// NOBODY is signed in as the member. The Owner keeps their own session; the
// server answers "who is this?" with the member and reads their data with the
// service role (lib/viewAsContext, lib/supabase/server). While it lasts:
//
//   - every change is refused on the server (403): proxy.ts refuses any request
//     that is not GET / HEAD, and any /api/auth or /api/admin request, except
//     the exit route; and every Supabase write made for the page — database,
//     storage, auth — is refused before it leaves the server or the browser
//     (lib/viewAsGuardCore);
//   - the member's last sign-in never moves and no visit is recorded as theirs;
//   - it ends after 30 minutes or on Exit;
//   - start and end are written to Audit and the member's Activity tab.
//
// The ticket (cookie tm_view_as) is "<id>.<expires ms>.<hmac>": the server
// signs it, so a browser cannot make one or stretch it.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const VIEW_AS_MINUTES = 30
export const VIEW_AS_MS = VIEW_AS_MINUTES * 60_000
export const VIEW_AS_COOKIE = 'tm_view_as'
/** A view started before 27 Oct 2026 kept the Owner's own refresh token here
 *  (sent only to the exit route). Read only so such a view can still end cleanly. */
export const VIEW_AS_OWNER_COOKIE = 'tm_view_as_owner'
/** Readable by the browser: the member's id, so the browser client answers as
 *  the member and refuses every write too. */
export const VIEW_AS_UI_COOKIE = 'tm_view_as_ui'
export const VIEW_AS_EXIT_PATH = '/api/admin/view-as/exit'
export const VIEW_AS_READ_ONLY = 'Viewing as this member — read only. Exit to make changes.'

export type ViewAsTicket = { id: string; expiresAt: number }

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(`view-as:${body}`).digest('base64url')
}

export function makeTicket(t: ViewAsTicket, secret: string): string {
  const body = `${t.id}.${t.expiresAt}`
  return `${body}.${sign(body, secret)}`
}

/** The ticket, or null when it is missing, forged or malformed (an expired
 *  one is returned — the caller ends it). */
export function readTicket(raw: string | null | undefined, secret: string | null | undefined): ViewAsTicket | null {
  if (!raw || !secret) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [id, exp, mac] = parts
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{10,16}$/.test(exp)) return null
  const want = Buffer.from(sign(`${id}.${exp}`, secret))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return { id, expiresAt: Number(exp) }
}

export function ticketExpired(t: ViewAsTicket, nowMs: number): boolean {
  return nowMs >= t.expiresAt
}

export type ViewAsDecision = 'pass' | 'block' | 'exit'

/**
 * What the proxy does with a request while a View-as ticket is present:
 * expired → send to the exit route; a change (any method but GET / HEAD), or
 * any /api/auth or /api/admin request → refused; else let it through. The exit
 * route itself always passes.
 */
export function viewAsDecision(t: ViewAsTicket, req: { method: string; pathname: string }, nowMs: number): ViewAsDecision {
  if (req.pathname === VIEW_AS_EXIT_PATH) return 'pass'
  if (ticketExpired(t, nowMs)) return 'exit'
  const method = req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return 'block'
  if (req.pathname.startsWith('/api/auth/') || req.pathname.startsWith('/api/admin/')) return 'block'
  return 'pass'
}

/** The session id inside a Supabase access token (its `session_id` claim). */
export function sessionIdOf(accessToken: string): string | null {
  const part = accessToken.split('.')[1]
  if (!part) return null
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { session_id?: string }
    return typeof json.session_id === 'string' ? json.session_id : null
  } catch {
    return null
  }
}

/** The dashboard a member of this role lands on. */
export function viewAsHome(role: string | null): string {
  return role === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'
}
