// lib/requestMethod.ts
//
// The HTTP method of the current request, as proxy.ts stamps it on every
// request it forwards (owner, 8 Oct 2026). Route handlers cannot read their own
// method through next/headers, and the Partner rule — view-only, every write
// refused on the server — needs it inside checkAdminRole. proxy.ts OVERWRITES
// the header on every request, so a client cannot send its own value.
//
// Pure (no server imports) so the rule is unit-tested.

export const METHOD_HEADER = 'x-tm-method'

/** GET and HEAD are reads. Anything else — or no stamp at all — is a write. */
export function isReadMethod(method: string | null | undefined): boolean {
  const m = (method ?? '').toUpperCase()
  return m === 'GET' || m === 'HEAD'
}
