'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { withFrom } from '@/lib/adminFromCore'

// "Breadcrumbs follow you" (owner, 20 Oct 2026), the browser half.
//
// 1. A click on a link to a member, tuition or tutor record from an admin list
//    opens it with `?from=<this list's address>` (lib/adminFromCore withFrom),
//    so the header trail names the list and links back to it — every list at
//    once, without each one building its own links. A new-tab or middle click
//    gets the same address.
// 2. Each admin page's scroll position is remembered for this tab. Coming back
//    to a list — the breadcrumb, the browser or the phone back button — puts
//    the page back where it was once the list has drawn.

const SCROLL_KEY = 'tm:admin-scroll:'
const RETURN_KEY = 'tm:admin-return'

const here = () => `${window.location.pathname}${window.location.search}`

function save(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* storage full or blocked: the list simply opens at the top */
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export default function AdminReturnKeeper() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()

  // 1 — add `from` to record links, and mark a return to a remembered list.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const target = `${url.pathname}${url.search}`
      // Back up the trail (a crumb or the back arrow) to a list we left: put
      // its scroll back once it draws.
      if (a.closest('nav[aria-label="Breadcrumb"]') && read(SCROLL_KEY + target) !== null) save(RETURN_KEY, target)
      const next = withFrom(`${target}${url.hash}`, here())
      if (next === `${target}${url.hash}`) return
      save(SCROLL_KEY + here(), String(window.scrollY))
      const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (!a.target || a.target === '_self')
      if (!plain) {
        // New tab / window: the browser opens the attribute as it is now.
        a.setAttribute('href', next)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      router.push(next)
    }
    const onAux = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const next = withFrom(`${url.pathname}${url.search}${url.hash}`, here())
      if (next !== `${url.pathname}${url.search}${url.hash}`) a.setAttribute('href', next)
    }
    const onPop = () => save(RETURN_KEY, here())
    window.addEventListener('click', onClick, true)
    window.addEventListener('mousedown', onAux, true)
    window.addEventListener('contextmenu', onAux, true)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('mousedown', onAux, true)
      window.removeEventListener('contextmenu', onAux, true)
      window.removeEventListener('popstate', onPop)
    }
  }, [router])

  // 2 — remember this page's scroll as it moves.
  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        save(SCROLL_KEY + here(), String(window.scrollY))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // ...and put it back on a return.
  const qs = search.toString()
  useEffect(() => {
    const url = here()
    if (read(RETURN_KEY) !== url) return
    save(RETURN_KEY, '')
    const y = Number(read(SCROLL_KEY + url))
    if (!Number.isFinite(y) || y <= 0) return
    let tries = 0
    let userMoved = false
    const stop = () => {
      userMoved = true
    }
    window.addEventListener('wheel', stop, { passive: true, once: true })
    window.addEventListener('touchstart', stop, { passive: true, once: true })
    const timer = window.setInterval(() => {
      tries += 1
      if (userMoved) return window.clearInterval(timer)
      window.scrollTo(0, y)
      if (Math.abs(window.scrollY - y) < 2 || tries > 40) window.clearInterval(timer)
    }, 50)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
    }
  }, [pathname, qs])

  return null
}
