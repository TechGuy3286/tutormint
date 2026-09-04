// lib/anonSession.ts
//
// A pseudonymous, per-device id for anonymous visitors, so a guest's searches
// can be collapsed into one demand signal without knowing who the guest is.
//
// It is a random uuid in a first-party, httpOnly cookie — NO IP, no
// fingerprint, no PII of any kind. Its only job is to let lib/anonSearch.ts
// dedupe a burst of typeahead refinements into a single search_event; it is
// never joined back to a person and never leaves our own server.
//
// Set in proxy.ts on the first request, the same place and the same way the
// first-touch UTM cookie is captured. Set only when ABSENT, so it is stable for
// the life of the cookie rather than re-minted per page.

export const ANON_COOKIE = 'tm_anon'

// Long enough that a returning visitor's searches over a few weeks count as the
// same session for de-duplication; this is a convenience id, not an identity.
export const ANON_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

/** A fresh anonymous session id. Random; carries no information about anyone. */
export function newAnonId(): string {
  return crypto.randomUUID()
}

/**
 * A stored anon id is only ever one we minted — a uuid. Reject anything else
 * (a hand-set cookie) rather than writing an attacker-supplied string into a
 * database column.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAnonId(v: string | undefined | null): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
