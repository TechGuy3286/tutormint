// lib/viewAsCore.ts — PURE apart from node:crypto. "View as" (owner, 26 Oct 2026).
//
// The Owner opens a member's dashboard exactly as they see it: the browser is
// given a session for the member (minted server-side, never a password or a
// code), with a fixed banner "Viewing as <name> — read only · Exit". While it
// lasts:
//
//   - every change is refused on the server (403): proxy.ts refuses any request
//     that is not GET / HEAD, and any /api/auth or /api/admin request, except
//     the exit route; and the database refuses every write made with the
//     minted session (migration 201's restrictive policies), so a browser that
//     writes to Supabase directly is refused too;
//   - it ends after 30 minutes or on Exit; the minted session is then removed
//     and the Owner's own session put back;
//   - start and end are written to Audit and the member's Activity tab.
//
// The ticket (cookie tm_view_as) is "<id>.<expires ms>.<hmac>": the server
// signs it, so a browser cannot make one or stretch it.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const VIEW_AS_MINUTES = 30
export const VIEW_AS_MS = VIEW_AS_MINUTES * 60_000
export const VIEW_AS_COOKIE = 'tm_view_as'
/** The Owner's own refresh token while viewing — sent only to the exit route. */
export const VIEW_AS_OWNER_COOKIE = 'tm_view_as_owner'
/** A readable marker so the browser client can refuse account changes too. */
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
