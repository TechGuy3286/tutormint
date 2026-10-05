'use client'

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

// The header Messages icon (PR 4 §3, #94), beside the bell — on phone AND
// desktop. It used to hide at lg because the desktop dock also covers messages;
// the owner wants the icon in the header at every width, so a member always has
// the same way into the inbox. Rendered only for signed-in tutors/parents
// (Navbar gates it on role), never in admin or for a signed-out visitor. It
// links to the full-screen inbox and carries the unread count, refreshed on
// window focus (the same "refresh on focus" the dock uses; the inbox's realtime
// lives inside a conversation).

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
      className="relative grid h-11 w-11 place-items-center rounded-full text-tm-navy transition-colors hover:bg-gray-100"
    >
      <MessageSquare size={20} aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-tm-red px-1 text-[9px] font-black text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
