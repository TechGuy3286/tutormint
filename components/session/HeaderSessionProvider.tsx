'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { hasAuthCookie, type HeaderSession } from '@/lib/headerSessionCore'

// Who is looking at this page (push 3, owner 1 Nov 2026). Public pages are now
// cached for everyone, so the server no longer knows; this context finds out in
// the browser. A visitor with no Supabase sign-in cookie is a guest at once,
// with no request. Anyone else is asked about once, from /api/session/header.
// It asks again when the cookie appears or disappears (sign-in, sign-out),
// checked on every navigation.

export type SessionState =
  | { status: 'guest' }
  | { status: 'checking' }
  | { status: 'signed-in'; session: Extract<HeaderSession, { signedIn: true }> }

type Ctx = { state: SessionState; refresh: () => void }

const SessionContext = createContext<Ctx>({ state: { status: 'guest' }, refresh: () => {} })

// useLayoutEffect warns on the server; this is a client-only component, but its
// first render still happens there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export default function HeaderSessionProvider({ children }: { children: React.ReactNode }) {
  // The server cannot know, and nearly every visitor is a guest: render as a
  // guest, then correct before paint when a sign-in cookie is present.
  const [state, setState] = useState<SessionState>({ status: 'guest' })
  const hadCookie = useRef<boolean | null>(null)
  const pathname = usePathname()

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/session/header', { cache: 'no-store', credentials: 'same-origin' })
      const body = (await res.json()) as HeaderSession
      setState(body.signedIn ? { status: 'signed-in', session: body } : { status: 'guest' })
    } catch {
      setState({ status: 'guest' })
    }
  }, [])

  useBrowserLayoutEffect(() => {
    const has = hasAuthCookie(document.cookie)
    if (hadCookie.current === has) return
    hadCookie.current = has
    if (!has) {
      setState({ status: 'guest' })
      return
    }
    setState({ status: 'checking' })
    void load()
  }, [pathname, load])

  // Signed in or out in another tab: re-check the cookie when this tab is shown
  // again. No request unless the cookie actually appeared or went.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== 'visible') return
      const has = hasAuthCookie(document.cookie)
      if (hadCookie.current === has) return
      hadCookie.current = has
      if (!has) setState({ status: 'guest' })
      else {
        setState({ status: 'checking' })
        void load()
      }
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [load])

  const refresh = useCallback(() => {
    hadCookie.current = null
    if (hasAuthCookie(document.cookie)) void load()
    else setState({ status: 'guest' })
  }, [load])

  return <SessionContext.Provider value={{ state, refresh }}>{children}</SessionContext.Provider>
}

export function useHeaderSession(): SessionState {
  return useContext(SessionContext).state
}

export function useRefreshHeaderSession(): () => void {
  return useContext(SessionContext).refresh
}
