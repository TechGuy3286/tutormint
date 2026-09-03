'use client'

import {
  Bell,
  Briefcase,
  ChevronDown,
  CreditCard,
  FilePlus2,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Send,
  Settings,
  Shield,
  UserRound,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import Avatar from '@/components/Avatar'
import { createClient } from '@/lib/supabase/client'
import type { MenuIcon, MenuItem } from '@/lib/userMenu'

// The signed-in member's menu.
//
// It replaced a single Dashboard button, and the reason is not decoration:
// /parent/dashboard/messages and /tutor/dashboard/messages were built, wired
// and reachable only by typing the URL. Nothing on the site linked to either.
//
// The items come from lib/userMenu.ts, resolved on the server. This component
// renders them and owns nothing but open/closed state — so the phone sheet and
// the desktop dropdown cannot drift apart, because they are the same array.
//
// A dropdown below 640px is a bad shape: it either overflows the viewport or
// scrolls inside a 200px box. Below sm it is a full-width sheet anchored to the
// bottom of the screen, where a thumb already is.

const ICONS: Record<MenuIcon, typeof Bell> = {
  dashboard: LayoutDashboard,
  applications: Briefcase,
  messages: MessageSquare,
  bell: Bell,
  profile: UserRound,
  package: CreditCard,
  settings: Settings,
  logout: LogOut,
  post: FilePlus2,
  jobs: Send,
  hired: Users,
  shield: Shield,
}

export default function UserMenu({
  name,
  avatarUrl,
  userId,
  items,
}: {
  name: string
  avatarUrl: string | null
  userId: string
  items: MenuItem[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  // Escape closes and returns focus to the trigger, which is where a keyboard
  // user expects to be — not at the top of the document.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    // pointerdown, not click: a click listener fires after the menu has already
    // been re-rendered and can close it on the very press that opened it.
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const logout = async () => {
    setBusy(true)
    await createClient().auth.signOut()
    setOpen(false)
    router.push('/')
    router.refresh()
  }

  const firstName = name.split(' ')[0] || name

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy sm:px-2.5"
      >
        <Avatar
          name={name}
          src={avatarUrl}
          seed={userId}
          decorative
          ring="border border-gray-200"
          className="h-8 w-8 text-[10px]"
        />
        <span className="hidden max-w-[10ch] truncate sm:inline">{firstName}</span>
        <ChevronDown aria-hidden size={14} className="shrink-0 text-gray-500" />
      </button>

      {open && (
        <>
          {/* The scrim exists only below sm, where the sheet covers content and
              a tap outside must be an obvious way back. */}
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-tm-black/40 sm:hidden"
          />

          <div
            role="menu"
            aria-label={`${firstName}’s menu`}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-2 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-64 sm:rounded-2xl"
          >
            <p className="truncate px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-gray-500 sm:hidden">
              {name}
            </p>

            {items.map((item) => {
              const Icon = ICONS[item.icon]
              return (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={`flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 text-xs font-bold text-tm-navy transition-colors hover:bg-tm-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-navy ${
                    item.separated ? 'mt-1 border-t border-gray-200 pt-1' : ''
                  }`}
                >
                  <Icon aria-hidden size={15} className="shrink-0 text-gray-500" />
                  {item.label}
                </Link>
              )
            })}

            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={busy}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-xs font-bold text-tm-red transition-colors hover:bg-tm-tint-red disabled:opacity-60"
            >
              <LogOut aria-hidden size={15} className="shrink-0" />
              {busy ? 'Signing out…' : 'Logout'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
