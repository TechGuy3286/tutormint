'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn } from 'lucide-react'

// The header's logged-out auth button. A client component so it can read the
// path: the button is hidden on the auth pages themselves (owner PR15 §3.3) —
// showing "Login" on /login (or on the sign-up page) is a button that goes where
// you already are. The Navbar is server-rendered once per (site) navigation, so
// this decision has to be client-side.
export default function AuthCTA() {
  const pathname = usePathname() ?? ''
  if (pathname === '/login' || pathname === '/register' || pathname === '/signup') return null

  return (
    <Link
      prefetch={false}
      href="/login"
      className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
    >
      <LogIn aria-hidden size={14} />
      Login
    </Link>
  )
}
