// lib/searchBeaconCore.ts
//
// The search beacon's ticket (owner, 13 Oct 2026). PURE apart from node:crypto —
// no database, no server-only import — so the route, the pages and the tests
// share it (scripts/test-search-beacon.ts).
//
// WHY A BEACON. The page render used to write the search row. A crawler renders
// pages too, so "which searches count" had to guess from the request (no cookie
// = not a person) — and that guess also dropped a real parent who landed from
// Google straight on /browse/tutors?q=…, because their first request has no
// cookie either. Now the page render writes NOTHING. It hands the browser a
// signed ticket describing the search it just rendered, and a real browser that
// has loaded the page posts the ticket back once. Only that post records the
// search. A crawler that never runs the page's script never posts.
//
// WHY SIGNED. The ticket is what the SERVER saw: the surface, the filters, the
// result count and whether nothing was found. Signing it means the post cannot
// be used to write a search nobody made, or an "unmet search" for text that did
// return results. It expires, so an old ticket cannot be replayed later.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const SEARCH_BEACON_PATH = '/api/search/log'

/** A ticket is good for this long after the page was rendered. */
export const BEACON_TTL_SECONDS = 30 * 60

/** The proxy forwards the visitor id it is about to set, so the first visit counts once. */
export const ANON_ID_HEADER = 'x-tm-anon-id'

export type BeaconSurface = 'tutors' | 'tuitions'

export type BeaconPayload = {
  /** Which Browse page. */
  s: BeaconSurface
  /** The filters the logs store — never the free text. */
  f: { master_id?: number | null; city?: string | null; area?: string | null; mode?: string | null; gender?: string | null }
  /** True when a filter or a search word was applied (a plain Browse visit is not a search). */
  x: boolean
  /** How many results the page found. */
  r: number
  /** The typed search, only when NOTHING was found (it feeds "Unmet searches"). */
  u: string | null
  /** Issued at, epoch seconds. */
  t: number
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(`search-beacon:${body}`).digest('base64url')
}

/** `<base64url payload>.<signature>`, or null with no secret (nothing is then recorded). */
export function signBeacon(payload: BeaconPayload, secret: string): string | null {
  if (!secret) return null
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body, secret)}`
}

/** The payload of a ticket we signed that has not expired; null otherwise. */
export function readBeacon(token: unknown, secret: string, nowMs = Date.now()): BeaconPayload | null {
  if (!secret || typeof token !== 'string' || token.length > 4000) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(body, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as BeaconPayload
    if (p.s !== 'tutors' && p.s !== 'tuitions') return null
    if (typeof p.t !== 'number' || typeof p.r !== 'number' || typeof p.f !== 'object' || p.f === null) return null
    const age = nowMs / 1000 - p.t
    if (age < -60 || age > BEACON_TTL_SECONDS) return null
    return p
  } catch {
    return null
  }
}

/** Is there anything to record? A plain Browse visit with no filter is not a search. */
export function beaconWorthSending(p: Pick<BeaconPayload, 'x' | 'u'>): boolean {
  return p.x || !!p.u
}
