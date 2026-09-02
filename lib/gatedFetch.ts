'use client'

import type { Gate } from '@/lib/gate'

// The client half of the gate contract.
//
// Every gated action posts through here, so "the server said no because of a
// plan" is handled in ONE place. Written as a helper rather than a convention
// because the previous arrangement was a convention: each caller read
// `json.error` and rendered it however it felt like, which is how a gated
// action ends up as a toast on one screen and a silently disabled button on
// another.
//
// A gate is not an error. It returns `{ gated: true }` so the caller can stop
// quietly -- the sheet has already explained what happened, and a red error
// line underneath saying the same thing twice is worse than nothing.

export type GatedResult<T> =
  | { ok: true; data: T }
  | { ok: false; gated: true }
  | { ok: false; gated: false; error: string }

export async function postGated<T = unknown>(
  url: string,
  body: unknown,
  showGate: ((gate: Gate) => void) | null | undefined,
  /** PATCH for an edit. Defaults to POST, which is what most gated calls are. */
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
): Promise<GatedResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, gated: false, error: 'Could not reach the server. Check your connection.' }
  }

  let json: { error?: string; gate?: Gate } & Record<string, unknown> = {}
  try {
    json = await res.json()
  } catch {
    /* an empty body on a 204 is fine */
  }

  if (res.ok) return { ok: true, data: json as T }

  // The whole point: a refusal the server described as a gate becomes the
  // sheet, whatever route it came from.
  if (json.gate && showGate) {
    showGate(json.gate)
    return { ok: false, gated: true }
  }

  return {
    ok: false,
    gated: false,
    error: json.error ?? 'That did not work. Please try again.',
  }
}
