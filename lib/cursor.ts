// An opaque list cursor.
//
// Base64url of a small JSON object. Opaque on purpose: the client stores it,
// puts it in a query string and hands it back, and never looks inside. That is
// what lets /browse/tutors key on (tier, location, score, hash) while
// /admin/audit keys on (created_at, id) with one hook and one footer component
// serving both.
//
// NOT a security boundary and not signed. Everything in a cursor is a sort-key
// value the caller can already see in the rows it was given, and every route
// that reads one re-applies its own filters and permission checks around it --
// a forged cursor can only move a reader to a different position in a list they
// were already allowed to read.

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeCursor<T extends Record<string, unknown>>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    // A truncated or hand-edited cursor means "start again", not a 500.
    return null
  }
}
