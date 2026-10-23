'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, UserPlus } from 'lucide-react'

import { headerAuthButtons } from '@/lib/headerAuth'
import { joinHrefForPath } from '@/lib/signupLinks'

// The header's signed-out buttons: "Join free" (primary) beside "Login"
// (secondary), on every public page at every width (owner, 15 Oct 2026 — the
// mobile header used to show only "Login", so a visitor had no visible way to
// join). Rendered only for a signed-out visitor: the Navbar shows the member or
// admin controls instead when there is a session.
//
// A client component so it can read the path: a button that goes where you
// already are is hidden (Join free on /register, Login on /login — owner PR15
// §3.3). The Navbar is server-rendered once per (site) navigation, so this
// decision has to be client-side.
export default function AuthCTA() {
  const pathname = usePathname() ?? ''
  const { join, login } = headerAuthButtons(pathname)
  // On a page aimed at parents, Join free opens sign-up with Parent selected
  // (owner, 24 Oct 2026); elsewhere Tutor, the default.
  const joinHref = joinHrefForPath(pathname)

  return (
    <>
      {join && (
        <Link
          prefetch={false}
          href={joinHref}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-red px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover min-[400px]:px-4"
        >
          <UserPlus aria-hidden size={14} className="hidden min-[360px]:block" />
          Join free
        </Link>
      )}
      {login && (
        <Link
          prefetch={false}
          href="/login"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy bg-white px-3 py-2 text-xs font-bold text-tm-navy transition-colors hover:bg-tm-navy/5 min-[400px]:px-4"
        >
          <LogIn aria-hidden size={14} className="hidden min-[400px]:block" />
          Login
        </Link>
      )}
    </>
  )
}
