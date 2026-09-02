'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createClient } from '@/lib/supabase/client'

// The one piece of the header that has to run in the browser.
//
// Signing out means clearing the Supabase cookies, which the client library
// does for us; router.refresh() then re-renders the server tree so the header
// swaps back to Login without a full page load.
//
// Below 640px it is icon-only. At 360 the logo, Dashboard and a text Logout
// do not fit on one line, and the alternative -- dropping Logout on mobile --
// takes away a function rather than a label. The 44px target and the
// accessible name are unchanged.
export default function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const logout = async () => {
    setBusy(true)
    await createClient().auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      aria-label="Log out"
      className="inline-flex h-11 min-h-[44px] w-11 items-center justify-center rounded-xl bg-tm-tint-red text-tm-red transition-colors hover:bg-tm-red/15 disabled:opacity-60 sm:w-auto sm:px-3.5"
    >
      <LogOut aria-hidden size={16} className="sm:hidden" />
      <span className="hidden text-xs font-bold sm:inline">Log out</span>
    </button>
  )
}
