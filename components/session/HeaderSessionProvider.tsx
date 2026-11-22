'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AUTH_MARK_ATTR, hasAuthCookie, headerAnswer, type HeaderSession } from '@/lib/headerSessionCore'

// Who is looking at this page (push 3, owner 1 Nov 2026). Public pages are now
// cached for everyone, so the server no longer knows; this context finds out in
// the browser. A visitor with no Supabase sign-in cookie is a guest at once,
// with no request. Anyone else is asked about once, from /api/session/header.
// It asks again when the cookie appears or disappears (sign-in, sign-out),
// checked on every navigation.
//
// PR-16 (owner, 22 Nov 2026 — "the dashboard header says Join free / Login"):
//   * signed-in pages (dashboards, onboarding, pay, account) are rendered per
//     request anyway, so their layout hands the header over directly
//     (HeaderSessionSeed) — no second request to get wrong;
//   * an answer that is not a clear "signed out" (network error, 5xx) never
//     shows the guest buttons: the placeholder stays and it asks again;
//   * the <html data-tm-auth> mark (root layout script) hides the guest
//     buttons before JavaScript runs; it is removed here when the server says
//     the cookie is no longer a session.

export type SessionState =
  | { status: 'guest' }
  | { status: 'checking' }
  | { status: 'signed-in'; session: Extract<HeaderSession, { signedIn: true }> }

type Ctx = { state: SessionState; refresh: () => void; seed: (s: HeaderSession) => void }

const SessionContext = createContext<Ctx>({ state: { status: 'guest' }, refresh: () => {}, seed: () => {} })

// useLayoutEffect warns on the server; this is a client-only component, but its
// first render still happens there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const RETRY_MS = 3000

function markGuest() {
  try {
    document.documentElement.removeAttribute(AUTH_MARK_ATTR)
  } catch {
    /* no document */
  }
}
function markSignedIn() {
  try {
    document.documentElement.setAttribute(AUTH_MARK_ATTR, '1')
  } catch {
    /* no document */
  }
}

export default function HeaderSessionProvider({ children }: { children: React.ReactNode }) {
  // The server cannot know, and nearly every visitor is a guest: render as a
  // guest, then correct before paint when a sign-in cookie is present.
  const [state, setState] = useState<SessionState>({ status: 'guest' })
  const hadCookie = useRef<boolean | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname = usePathname()

  const toGuest = useCallback(() => {
    markGuest()
    setState({ status: 'guest' })
  }, [])

  const load = useCallback(async () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    let status: number | null = null
    let body: unknown = null
    try {
      const res = await fetch('/api/session/header', { cache: 'no-store', credentials: 'same-origin' })
      status = res.status
      body = await res.json().catch(() => null)
    } catch {
      status = null
    }
    const answer = headerAnswer(status, body)
    if (answer === 'signed-in') {
      markSignedIn()
      setState({ status: 'signed-in', session: body as Extract<HeaderSession, { signedIn: true }> })
    } else if (answer === 'guest') {
      toGuest()
    } else {
      // Unknown: keep the placeholder, ask again shortly and on the next page.
      hadCookie.current = null
      retryTimer.current = setTimeout(() => {
        if (hasAuthCookie(document.cookie)) {
          hadCookie.current = true
          void load()
        } else toGuest()
      }, RETRY_MS)
    }
  }, [toGuest])

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
  }, [])

  useBrowserLayoutEffect(() => {
    const has = hasAuthCookie(document.cookie)
    if (hadCookie.current === has) return
    hadCookie.current = has
    if (!has) {
      toGuest()
      return
    }
    setState((prev) => (prev.status === 'signed-in' ? prev : { status: 'checking' }))
    void load()
  }, [pathname, load, toGuest])

  // Signed in or out in another tab: re-check the cookie when this tab is shown
  // again. No request unless the cookie actually appeared or went.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== 'visible') return
      const has = hasAuthCookie(document.cookie)
      if (hadCookie.current === has) return
      hadCookie.current = has
      if (!has) toGuest()
      else {
        setState({ status: 'checking' })
        void load()
      }
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [load, toGuest])

  const refresh = useCallback(() => {
    hadCookie.current = null
    if (hasAuthCookie(document.cookie)) void load()
    else toGuest()
  }, [load, toGuest])

  // A per-request layout already knows who is signed in (HeaderSessionSeed).
  // Children's layout effects run before this provider's, so the cookie check
  // above then finds hadCookie already true and asks nothing.
  const seed = useCallback(
    (s: HeaderSession) => {
      if (!s.signedIn) return
      hadCookie.current = true
      markSignedIn()
      setState({ status: 'signed-in', session: s })
    },
    [],
  )

  return <SessionContext.Provider value={{ state, refresh, seed }}>{children}</SessionContext.Provider>
}

export function useHeaderSession(): SessionState {
  return useContext(SessionContext).state
}

export function useRefreshHeaderSession(): () => void {
  return useContext(SessionContext).refresh
}

/** For HeaderSessionSeed only. */
export function useSeedHeaderSession(): (s: HeaderSession) => void {
  return useContext(SessionContext).seed
}
