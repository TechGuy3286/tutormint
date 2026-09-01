'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

// The offline state.
//
// A banner, not an /offline page. An offline page can only be served by a
// service worker holding it in cache, and a service worker is a real ongoing
// commitment — cache invalidation, update cycles, a whole class of "why am I
// seeing yesterday's version" bugs. That is not a trade worth making before
// launch for a site whose pages are all server-rendered anyway.
//
// What this does instead is tell the truth at the moment it becomes useful:
// the connection dropped, so the button you just pressed did nothing, and that
// is not the site being broken. On patchy mobile data — which is most of the
// audience most of the time — that distinction is the whole point.
//
// Rendered from the root layout, so it is present on every page.

export default function OfflineNotice() {
  // Starts as "online" rather than reading navigator.onLine during render:
  // the server has no navigator, and guessing produces a hydration mismatch on
  // every single page load. The effect below corrects it immediately.
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-tm-black px-4 py-3 text-center text-xs font-bold text-white"
    >
      <WifiOff size={16} className="shrink-0" aria-hidden />
      <span>You are offline. Anything you type is safe — it will send when you reconnect.</span>
    </div>
  )
}
