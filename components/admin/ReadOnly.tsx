'use client'

import { createContext, useContext, useEffect } from 'react'

import { isReadMethod } from '@/lib/requestMethod'

// View-only admin sessions (owner, 8 Oct 2026): the Partner role opens every
// admin page and changes nothing.
//
// PRESENTATION ONLY. The rule itself is enforced on the server — checkAdminRole
// answers 403 to a Partner on every non-GET request, and the database write
// policies exclude the role (migration 150). This file only HIDES the controls
// that would write, so a Partner is not offered a door that is locked:
//
//   useAdminReadOnly()   true in a Partner session
//   <WriteOnly>…         renders its children only when the session can write
//
// The layout provides the flag once for the whole admin area.

const ReadOnlyContext = createContext(false)

export const PARTNER_VIEW_ONLY_TEXT = 'Partner accounts are view-only. This change was not made.'

export function AdminReadOnlyProvider({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  // Belt and braces for any write control a screen forgot to wrap: in a
  // view-only session a non-GET call to /api/admin never leaves the browser and
  // reads as the server's own 403. Its two-factor routes stay open — setting up
  // two-factor is required of a Partner.
  useEffect(() => {
    if (!readOnly || typeof window === 'undefined') return
    const original = window.fetch
    const guarded: typeof window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      let path = ''
      try {
        path = new URL(url, window.location.origin).pathname
      } catch {
        path = url
      }
      if (path.startsWith('/api/admin/') && !path.startsWith('/api/admin/mfa/') && !isReadMethod(method)) {
        return new Response(JSON.stringify({ error: PARTNER_VIEW_ONLY_TEXT }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return original(input, init)
    }
    window.fetch = guarded
    return () => {
      if (window.fetch === guarded) window.fetch = original
    }
  }, [readOnly])

  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>
}

/** True in a view-only (Partner) admin session. */
export function useAdminReadOnly(): boolean {
  return useContext(ReadOnlyContext)
}

/** Renders its children only when this admin session may change things. */
export function WriteOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return useAdminReadOnly() ? <>{fallback}</> : <>{children}</>
}

/** One line shown in place of a write-only screen (Post a tuition, Bulk import…). */
export function ViewOnlyNotice({ what }: { what?: string }) {
  return (
    <p className="rounded-2xl border border-gray-200 bg-white p-4 text-center text-xs font-bold text-tm-navy">
      {what ? `${what} — ` : ''}Partner accounts are view-only. Nothing can be changed here.
    </p>
  )
}
