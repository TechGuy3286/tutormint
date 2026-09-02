// Recent searches, per device.
//
// localStorage is the right home for exactly this and almost nothing else on
// the platform. CLAUDE.md rule 2 bans it for login and role state, because
// those have to survive being lied to; a list of things this browser searched
// for is neither, it is a convenience that belongs to the device rather than
// to the account. The spec asks for it in those words: "recent searches
// (local, per device)".
//
// Nothing here is trusted. A stored entry becomes a suggestion the member can
// click, never a filter that is applied on their behalf, so a tampered value
// costs the tamperer one bad search of their own.

const KEY = 'tutormint_recent_searches'
const MAX = 6

/** Reads the list, tolerating every way storage can be unavailable. */
export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.slice(0, 80))
      .slice(0, MAX)
  } catch {
    // Private windows, cleared site data, and browsers set to block storage
    // all land here. An empty list is a correct answer, not an error.
    return []
  }
}

/** Records a COMMITTED search. Keystrokes are not searches. */
export function pushRecent(query: string): void {
  const q = query.trim()
  if (q.length < 2) return
  try {
    const next = [q, ...readRecent().filter((v) => v.toLowerCase() !== q.toLowerCase())].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storing a convenience is never worth an exception reaching the user.
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}
