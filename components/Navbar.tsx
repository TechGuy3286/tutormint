import Link from 'next/link'

import LogoutButton from '@/components/LogoutButton'
import { getSessionUser } from '@/lib/auth'
import { homeForRole } from '@/lib/authRoutes'

// The site header. A SERVER component, deliberately.
//
// It used to be a client component that fetched the user in useEffect, which
// meant every page rendered "signed out" first and then corrected itself a
// beat later. On a header that is the difference between Login and Dashboard,
// that flash is not cosmetic: it tells a signed-in member they are signed out.
//
// WHAT THIS COSTS, stated plainly. Reading the session reads cookies, and a
// cookies() read in a component the root layout renders opts every route in
// the app out of static prerendering -- including the homepage and the legal
// pages, which were static before this. Two things make that an acceptable
// trade rather than a regression:
//
//   * proxy.ts already calls supabase.auth.getUser() on every non-asset
//     request, homepage included, to keep the session fresh. The auth round
//     trip was already being paid on each of these hits; what is new is the
//     RSC render, and these pages are small.
//   * getSessionUser() is React-cache()d, so the header, the area layout and
//     the page share one auth call and one profiles read per request. An
//     anonymous visitor -- most of the traffic on the pages that were static --
//     stops at getUser() returning null and never touches profiles.
//
// The way to have both is cacheComponents (Next 16's PPR) with this header in
// a Suspense boundary: a static shell with a dynamic hole. That flag changes
// caching semantics for the whole application and belongs in its own change,
// not bundled into a header button. It is on the T8b list.
export default async function Navbar() {
  const session = await getSessionUser()
  const role = session?.profile?.role ?? null
  const name = session?.profile?.full_name ?? session?.user.email?.split('@')[0] ?? null

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3.5 shadow-xs sm:px-12">
      <Link href="/" className="flex shrink-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="TutorMint" className="h-12 w-auto object-contain sm:h-16" />
      </Link>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {session ? (
          <>
            <span className="hidden text-xs font-bold text-slate-700 md:inline">
              Welcome, {name ?? 'there'}
            </span>
            <Link
              href={homeForRole(role)}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-navy px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover"
            >
              Dashboard
            </Link>
            <LogoutButton />
          </>
        ) : (
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
          >
            Login
          </Link>
        )}
      </div>
    </header>
  )
}
