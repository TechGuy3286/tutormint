'use client'

// A per-user, per-page autosave for long forms (PR106-H4 §5). localStorage, so
// it survives a refresh, a closed tab and a Back navigation (sessionStorage
// would not survive a closed tab). CLAUDE.md rule 2 forbids localStorage for
// login/role state only — an unsaved form draft is neither. Every access is
// wrapped so a private window or blocked storage never breaks the form; a draft
// that cannot be read simply means the form opens empty.

const PREFIX = 'tm:formdraft:'
const MAX = 200_000 // a tuition draft is tiny; cap so we never fill the quota.

export function saveFormDraft(key: string, data: unknown): void {
  try {
    const s = JSON.stringify(data)
    if (s.length > MAX) return
    localStorage.setItem(PREFIX + key, s)
  } catch {
    /* private window / quota / disabled — fine */
  }
}

export function loadFormDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function clearFormDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* fine */
  }
}
