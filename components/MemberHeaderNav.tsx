'use client'

import { LogOut, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { getBrowserClient } from '@/lib/supabase/clientLazy'

// Settings and Logout in the signed-in member header, ALWAYS VISIBLE (owner,
// 9 Oct 2026). They used to sit in a dropdown under the avatar ("Ali ⌄"), and
// non-technical tutors could not find Settings. Tutors and parents only — the
// admin bar and an admin's site header keep their own controls (UserMenu).
//
// Phone-first: below sm each control is an icon with a small label UNDERNEATH,
// so Messages, Notifications, Settings and Logout fit one row at 320px. From sm
// the icon and label sit side by side, the same 44px height and bordered style
// as the notification bell.

export const MEMBER_SETTINGS_HREF = {
  tutor: '/tutor/dashboard/settings',
  parent: '/parent/dashboard/settings',
} as const

const BOX =
  'inline-flex h-11 min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-xl border bg-white px-1 text-[9px] font-bold leading-none transition-colors sm:flex-row sm:gap-1.5 sm:px-3 sm:text-xs'

export function HeaderSettingsLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`${BOX} border-gray-200 text-tm-navy hover:border-tm-navy`}
    >
      <Settings aria-hidden size={16} className="shrink-0" />
      <span>Settings</span>
    </Link>
  )
}

export function HeaderLogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // The same sign-out flow the dropdown used: sign out, then home + refresh.
  const logout = async () => {
    setBusy(true)
    try {
      await (await getBrowserClient()).auth.signOut()
    } finally {
      // Cleared whatever happened — sign-out is the control a member reaches
      // for when something has already gone wrong; it must not stay disabled.
      setBusy(false)
    }
    router.push('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      aria-label={busy ? 'Signing out' : 'Logout'}
      className={`${BOX} border-gray-200 text-tm-red hover:border-tm-red hover:bg-tm-tint-red disabled:opacity-60`}
    >
      <LogOut aria-hidden size={16} className="shrink-0" />
      <span>Logout</span>
    </button>
  )
}

/** Settings then Logout, in header order (after Messages and Notifications). */
export default function MemberHeaderNav({ settingsHref }: { settingsHref: string }) {
  return (
    <>
      <HeaderSettingsLink href={settingsHref} />
      <HeaderLogoutButton />
    </>
  )
}
