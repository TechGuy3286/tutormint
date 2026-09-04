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
import { UTM_COOKIE, UTM_MAX_AGE_SECONDS, encodeUtm, readUtmFromUrl } from '@/lib/utm'

// /pay/* is the checkout journey (gateway hand-off, transfer instructions,
// return screen). Every page under it reads the signed-in member's own
// payment row, so an anonymous hit has nothing to show and belongs at /login.
const PROTECTED = ['/tutor/dashboard', '/parent/dashboard', '/admin', '/pay']

// The areas the phone gate covers: everything a signed-in member does with the
// product. Listed one path at a time rather than as '/tutor' and '/parent'
// prefixes, because /tutor/[slug] is a PUBLIC tutor profile and the platform's
// organic-search surface — gating it would put the marketing pages behind a
// login. /tutor/claim is also absent: an imported tutor's gate is the claim
// flow, and they must be able to reach it.
const PHONE_GATED = [
  '/tutor/dashboard',
  '/tutor/complete-profile',
  '/tutor/upload-youtube',
  '/tutor/packages',
  '/parent/dashboard',
  '/parent/packages',
  '/parent/verify',
  '/admin',
  '/pay',
  '/account',
  '/messages',
]

function matches(pathname: string, list: string[]): boolean {
  return list.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * The current path, forwarded to server components.
 *
 * Next gives a layout no way to ask which URL is rendering, and the root
 * layout has to know one thing: whether this request is inside /admin, which
 * renders its own header and must not also get the site one. Route groups
 * cannot answer it either — there is a single root layout and /admin nests
 * inside it. So the path is put on the request here and read with headers().
 */
const PATH_HEADER = 'x-tm-pathname'

function withPath(request: NextRequest): Headers {
  const headers = new Headers(request.headers)
  headers.set(PATH_HEADER, request.nextUrl.pathname)
  return headers
}

/**
 * First-touch acquisition capture.
 *
 * Set only when the cookie is ABSENT. A member who arrives from an ad, leaves,
 * and returns a week later through a brand search is still credited to the ad
 * — last-touch would credit the search, which is how brand search reliably
 * comes to look like the best-performing channel when it is really where
 * people go once an ad has already done its work.
 *
 * Done here rather than in a client component because it must work on the very
 * first byte of the very first page, before any JavaScript has run and
 * whichever page the ad pointed at. httpOnly: nothing in the browser needs to
 * read it, and the value is attacker-supplied.
 */
function captureUtm(request: NextRequest, response: NextResponse): void {
  if (request.cookies.has(UTM_COOKIE)) return
  const utm = readUtmFromUrl(request.nextUrl)
  if (!utm) return
  response.cookies.set(UTM_COOKIE, encodeUtm(utm), {
    maxAge: UTM_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: withPath(request) } })
  captureUtm(request, response)

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
        // Rebuilt with the same forwarded path — dropping it here would make
        // the header present only on requests that did not refresh a token.
        response = NextResponse.next({ request: { headers: withPath(request) } })
        // Re-applied for the same reason the path header is: this rebuilds the
        // response, and anything set on the old one is gone. Dropping it here
        // would lose attribution on exactly the requests that refreshed a
        // token, which is a subset nobody would think to test.
        captureUtm(request, response)
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

  // NOTHING TO DO WITH SLUGS OR TUITIONS HAPPENS HERE ANY MORE.
  //
  // For one week this file answered a retired tutor slug with a real 301 and a
  // closed tuition with a real 410, because a page cannot set its own status
  // code. Both needed a database round trip on EVERY request to
  // /tutor/<anything> and /tuitions/<city>/<slug> — including the great
  // majority that resolve perfectly well — because nothing in a URL says
  // whether the address is live or retired.
  //
  // That is a permanent cost on the platform's two organic-search surfaces to
  // buy a difference in status code that Google and Bing treat identically
  // (308 is the permanent redirect; 301 is its HTTP/1.0-era predecessor). The
  // pages do both themselves now — see app/tutor/[slug] and
  // app/tuitions/[city]/[slug].
  if (!user && matches(pathname, PROTECTED)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // The phone gate.
  //
  // An account created through mobile-first signup cannot use the product
  // until the number it gave has been proved. While that is outstanding,
  // /verify-phone is the only authenticated page it can reach.
  //
  // This costs one profiles read, and it is taken ONLY on the gated paths --
  // never on a public page, which is the great majority of requests. The read
  // goes through the member's own session, so RLS applies and no service key
  // is involved.
  //
  // The condition is deliberately `phone_gate_required AND no verified_at`,
  // not `no verified_at` alone: 21 of the 28 accounts that existed when this
  // shipped had never been asked for a number, and the looser test would have
  // locked every one of them out of their own dashboard. See
  // supabase/migrations/29 for the full reasoning.
  if (user && matches(pathname, PHONE_GATED)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone_gate_required, phone_verified_at')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.phone_gate_required && !profile.phone_verified_at) {
      const url = request.nextUrl.clone()
      url.pathname = '/verify-phone'
      url.search = ''
      // Preserved so a guest who was mid-action -- the AuthGateModal journey --
      // is returned to what they were doing, not dropped on a dashboard.
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  // Skip static assets and image optimisation; everything else passes through
  // so sessions stay fresh on public pages too.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
