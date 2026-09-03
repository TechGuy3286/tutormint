'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createClient } from '@/lib/supabase/client'

// Sign out, in the admin bar.
//
// The admin bar's "Exit" goes to the public site and has never signed anybody
// out — the only way to end an admin session was the site header's menu, which
// is exactly the duplicate header this change removes. Folding sign-out in
// here is what makes removing that header safe rather than a lost function.
//
// Kept separate from Exit rather than replacing it: leaving the admin panel
// and ending a privileged session are different intentions, and a moderator
// who wanted the site back should not be logged out for asking.

export default function AdminSignOut({ tone = 'dark' }: { tone?: 'light' | 'dark' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await createClient().auth.signOut()
        router.push('/')
        router.refresh()
      }}
      aria-label="Sign out"
      className={`flex min-h-[44px] shrink-0 items-center gap-1.5 px-2 text-[11px] font-bold transition-colors disabled:opacity-60 sm:px-3 ${
        tone === 'dark'
          ? 'text-gray-300 hover:text-white'
          : 'text-gray-500 hover:text-tm-navy'
      }`}
    >
      <LogOut aria-hidden size={14} />
      {/* Icon only on a phone — the label is what pushed Exit off the edge.
          aria-label above keeps it announced either way. */}
      <span className="hidden sm:inline">{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
  )
}
