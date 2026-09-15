'use client'

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

// The header chat icon (PR 4 §3), beside the bell. Phone only (<1024px): on
// desktop the messages dock covers messages, so this hides at lg. It links to the
// full-screen inbox and carries the unread badge, refreshed on window focus (the
// same "refresh on focus" the dock uses; the inbox's realtime lives inside a
// conversation).

export default function HeaderMessages({ href, initialUnread }: { href: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/messages/unread', { headers: { accept: 'application/json' } })
      if (r.ok) setUnread((await r.json()).count ?? 0)
    } catch {
      /* keep the last count */
    }
  }, [])

  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return (
    <Link
      href={href}
      aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      className="relative grid h-11 w-11 place-items-center rounded-full text-tm-navy transition-colors hover:bg-gray-100 lg:hidden"
    >
      <MessageSquare size={20} aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-tm-red px-1 text-[9px] font-black text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
