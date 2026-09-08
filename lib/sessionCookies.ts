// "Remember me" (owner, Sunday 6 Sep). Checked (the default) leaves the session
// persistent, exactly as before. Unchecked means the Supabase auth cookies must
// be SESSION cookies — gone when the browser closes.
//
// @supabase/ssr sets a maxAge on the sb-* auth cookies from the token expiry, so
// making them session cookies means stripping maxAge/expires from those cookies
// on EVERY response that (re)writes them — not just at login, or the next token
// refresh in proxy.ts would silently make them persistent again. The member's
// choice is remembered in a small first-party flag cookie, `tm_persist`, which
// both the server client and the proxy read.
//
// Only the sb-* auth cookies are touched; everything else keeps its options.

export const PERSIST_COOKIE = 'tm_persist'

/** True when the member chose NOT to be remembered (flag cookie is '0'). */
export function persistOffFrom(value: string | null | undefined): boolean {
  return value === '0'
}

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> }

/**
 * When persistence is off, turn an sb-* auth cookie into a session cookie by
 * dropping its maxAge/expires. A no-op for any other cookie, and a no-op when
 * persistence is on.
 */
export function applySessionPersistence<T extends CookieToSet>(cookie: T, persistOff: boolean): T {
  if (!persistOff || !cookie.name.startsWith('sb-')) return cookie
  const options = { ...(cookie.options ?? {}) }
  delete options.maxAge
  delete options.expires
  return { ...cookie, options }
}
