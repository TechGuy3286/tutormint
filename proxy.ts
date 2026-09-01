// proxy.ts  (Next 16 renamed the middleware convention to proxy)
//
// Two jobs, in order:
//   1. Refresh the Supabase session on every request. getUser() revalidates
//      the JWT and, when it is refreshed, @supabase/ssr writes new cookies --
//      which only stick if they are set on the response that is returned. That
//      is why `response` is rebuilt in setAll and returned at the end.
//   2. Protect the three dashboard areas. Everything else stays public: per
//      the product philosophy nobody is asked to sign in until they attempt a
//      transactional action, and browsing is fully open.
//
// Unauthenticated hits on a protected area redirect to /login?next=<path> so
// the user lands back where they were headed.
//
// Role checking is NOT done here -- it needs a profiles read, and proxy runs
// on every request. The server layouts do that with getSessionUser().

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// /pay/* is the checkout journey (gateway hand-off, transfer instructions,
// return screen). Every page under it reads the signed-in member's own
// payment row, so an anonymous hit has nothing to show and belongs at /login.
const PROTECTED = ['/tutor/dashboard', '/parent/dashboard', '/admin', '/pay']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Without env there is nothing to refresh; let the request through rather
  // than locking every page behind a 500.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return response
  }

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // Do not put anything between createServerClient and getUser: it is this
  // call that refreshes an expired token and triggers setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && PROTECTED.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  // Skip static assets and image optimisation; everything else passes through
  // so sessions stay fresh on public pages too.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
