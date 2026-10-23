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
import { ANON_COOKIE, ANON_MAX_AGE_SECONDS, newAnonId } from '@/lib/anonSession'
import { PERSIST_COOKIE, persistOffFrom, applySessionPersistence } from '@/lib/sessionCookies'
import { needsPhoneGate } from '@/lib/phoneGate'
import { METHOD_HEADER } from '@/lib/requestMethod'
import { NEW_VISITOR_HEADER } from '@/lib/searchCountCore'
import { ANON_ID_HEADER } from '@/lib/searchBeaconCore'
import { areaHubRedirectPath } from '@/lib/areaHubRedirect'
import { convertedTutorRedirectPath } from '@/lib/convertedTutorRedirect'

// /pay/* is the checkout journey (gateway hand-off, transfer instructions,
// return screen). Every page under it reads the signed-in member's own
// payment row, so an anonymous hit has nothing to show and belongs at /login.
const PROTECTED = ['/tutor/dashboard', '/tutor/onboarding', '/parent/dashboard', '/admin', '/pay']

// The areas the phone gate covers: everything a signed-in member does with the
// product. Listed one path at a time rather than as '/tutor' and '/parent'
// prefixes, because /tutor/[slug] is a PUBLIC tutor profile and the platform's
// organic-search surface — gating it would put the marketing pages behind a
// login. /tutor/claim is also absent: an imported tutor's gate is the claim
// flow, and they must be able to reach it.
const PHONE_GATED = [
  '/tutor/dashboard',
  '/tutor/onboarding',
  '/tutor/complete-profile',
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

/*
 * THE PATH HEADER IS GONE, AND ONE NARROW HEADER REPLACES IT.
 *
 * This file used to copy request.nextUrl.pathname onto `x-tm-pathname` for
 * every request, so the root layout's Navbar, Footer and PreviewBanner could
 * each ask whether they were under /admin. That read was correct on a full page
 * load and STALE on every client navigation after one — a root layout is not
 * re-rendered when the route below it changes — so leaving /admin without a
 * reload produced a site with no chrome at all. app/(site) is a route group
 * whose layout owns the chrome now, which is a question the router answers by
 * itself, and that header is gone.
 *
 * `x-tm-tuition-city` is not the same mistake, for two reasons worth stating
 * because the two look alike:
 *
 *   * It is read by a LEAF, not by the root layout —
 *     app/(site)/tuitions/[city]/[slug]/not-found.tsx. A leaf is re-rendered on
 *     every navigation, full load or RSC fetch, and that fetch goes through
 *     here with the real URL. There is no window in which it can be stale.
 *   * A not-found boundary takes no props and cannot read route params, and
 *     usePathname() is not available to it: a nested not-found.tsx that renders
 *     ANY Client Component is silently ignored in Next 16.3 and the parent
 *     boundary renders instead (verified — a server component in the same file
 *     renders; a client one, colocated or imported, does not). So the segment
 *     of the URL naming the city has to arrive some other way, and this is the
 *     only one.
 *
 * Set on /tuitions/* only, from the URL. No database read — the city is already
 * in the path — so a closed tuition still costs exactly one query, the one that
 * came back empty.
 */
const TUITION_CITY_HEADER = 'x-tm-tuition-city'

/*
 * `x-tm-method` — the request's HTTP method, stamped on EVERY request (owner,
 * 8 Oct 2026). A route handler cannot read its own method through
 * next/headers, and checkAdminRole() needs it to refuse every write by the
 * view-only Partner role. Always OVERWRITTEN from the real method, so a client
 * that sends its own `x-tm-method` gets nothing.
 */
// The visitor id minted for a request that arrived without one — the SAME id
// goes on the response cookie and to the route (ANON_ID_HEADER), so the search
// beacon can count a cookieless first visit once (lib/searchBeaconCore).
const mintedAnon = new WeakMap<NextRequest, string>()
function mintedAnonId(request: NextRequest): string | null {
  if (request.cookies.has(ANON_COOKIE)) return null
  let id = mintedAnon.get(request)
  if (!id) {
    id = newAnonId()
    mintedAnon.set(request, id)
  }
  return id
}

function forwardHeaders(request: NextRequest): { headers: Headers } {
  const headers = new Headers(request.headers)
  headers.set(METHOD_HEADER, request.method)
  // Did the browser send the visitor cookie? A crawler never does, so each of
  // its requests is a "new visitor" — the search logs do not count those
  // (lib/searchCountCore). Always overwritten, so a client cannot fake it.
  headers.set(NEW_VISITOR_HEADER, request.cookies.has(ANON_COOKIE) ? '0' : '1')
  // Always overwritten or removed, so a client cannot supply its own.
  const minted = mintedAnonId(request)
  if (minted) headers.set(ANON_ID_HEADER, minted)
  else headers.delete(ANON_ID_HEADER)
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/tuitions/')) {
    const city = pathname.split('/')[2]
    if (city) headers.set(TUITION_CITY_HEADER, city)
    else headers.delete(TUITION_CITY_HEADER)
  } else {
    headers.delete(TUITION_CITY_HEADER)
  }
  return { headers }
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

/**
 * A pseudonymous per-device id for anonymous search telemetry.
 *
 * Set only when ABSENT (like the UTM cookie), so it is stable for the life of
 * the cookie. It is a random uuid — no IP, no fingerprint, no PII. httpOnly:
 * nothing in the browser needs to read it, and it must not be settable from
 * client script. The browse page reads it server-side to collapse a guest's
 * searches into one demand signal; see lib/anonSearch.ts.
 */
function captureAnon(request: NextRequest, response: NextResponse): void {
  const minted = mintedAnonId(request)
  if (!minted) return
  response.cookies.set(ANON_COOKIE, minted, {
    maxAge: ANON_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
}

export async function proxy(request: NextRequest) {
  // /apply — the short link on "Hiring tutors" posts (owner, 7 Oct 2026). Any
  // capitalisation (/Apply, /APPLY) sends a TEMPORARY 307 to /register with
  // every query parameter kept, so utm_* reach /register and the signup records
  // them as usual. Temporary so /register stays the URL Google knows; /apply is
  // never in the sitemap. Handled here because next.config redirects match
  // case-sensitively.
  if (request.nextUrl.pathname.toLowerCase() === '/apply') {
    const target = request.nextUrl.clone()
    target.pathname = '/register'
    return NextResponse.redirect(target, 307)
  }

  // The old per-audience plan addresses (owner, 12 Oct 2026): a 301 to the
  // CLEAN /membership-plans, with any query string dropped — so
  // /tutor/packages?plan=featured does not mint a second address for one page.
  // Here rather than in next.config, whose redirects carry the query across.
  if (request.nextUrl.pathname === '/tutor/packages' || request.nextUrl.pathname === '/parent/packages') {
    const target = request.nextUrl.clone()
    target.pathname = '/membership-plans'
    target.search = ''
    return NextResponse.redirect(target, 301)
  }

  // An area hub whose address was merged into another (owner, 13 Oct 2026):
  // /tuition-jobs/lahore/dha-lahore → /tuition-jobs/lahore/dha, a 301. Only
  // these two-segment hub addresses are looked at; the curated list behind the
  // rule is held in memory (lib/areaHubRedirect).
  if (request.nextUrl.pathname.startsWith('/tuition-jobs/')) {
    const moved = await areaHubRedirectPath(request.nextUrl.pathname)
    if (moved) {
      const target = request.nextUrl.clone()
      target.pathname = moved
      return NextResponse.redirect(target, 301)
    }
  }

  // A tutor profile hidden because the account was changed to a parent
  // account (owner, 23 Oct 2026): a 301 to Browse tutors for their city. The
  // list behind it is held in memory for a minute (lib/convertedTutorRedirect).
  if (request.nextUrl.pathname.startsWith('/tutor/')) {
    const moved = await convertedTutorRedirectPath(request.nextUrl.pathname)
    if (moved) {
      const target = request.nextUrl.clone()
      const [path, query] = moved.split('?')
      target.pathname = path
      target.search = query ? `?${query}` : ''
      return NextResponse.redirect(target, 301)
    }
  }

  // Rebuilt after a token refresh (setAll below) so the page sees the NEW
  // session cookies, not the copy taken here.
  let forwarded = forwardHeaders(request)
  let response = NextResponse.next({ request: forwarded })
  captureUtm(request, response)
  captureAnon(request, response)

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
        forwarded = forwardHeaders(request)
        response = NextResponse.next({ request: forwarded })
        // Re-applied because this REBUILDS the response, and anything set on
        // the old one is gone. Dropping it here would lose attribution on
        // exactly the requests that refreshed a token, which is a subset
        // nobody would think to test.
        captureUtm(request, response)
        captureAnon(request, response)
        // "Remember me" off: keep the refreshed sb-* cookies as session
        // cookies, or a token refresh here would re-persist a session the
        // member asked not to be remembered.
        const persistOff = persistOffFrom(request.cookies.get(PERSIST_COOKIE)?.value)
        cookiesToSet.forEach((cookie) => {
          const { name, value, options } = applySessionPersistence(cookie, persistOff)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // Do not put anything between createServerClient and getUser: it is this
  // call that refreshes an expired token and triggers setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl

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
  // /pay/return is the gateway landing (PR106-B §9). A payment provider can send
  // the member back without a live session (different browser, expired cookie),
  // and that return must never be an auth redirect — the page renders a neutral
  // "being processed — sign in" result itself (200, no dead end). The rest of
  // /pay/* stays protected. Exempt it BEFORE the protected check.
  const isPayReturn = pathname === '/pay/return' || pathname.startsWith('/pay/return/')
  if (!user && !isPayReturn && matches(pathname, PROTECTED)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    // The whole address, query string included: /pay/choose?plan=premium has
    // to come back as that, not as a bare /pay/choose with no package.
    url.searchParams.set('next', pathname + search)
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

    if (needsPhoneGate(profile)) {
      const url = request.nextUrl.clone()
      url.pathname = '/verify-phone'
      url.search = ''
      // Preserved so a guest who was mid-action -- the AuthGateModal journey --
      // is returned to what they were doing, not dropped on a dashboard.
      url.searchParams.set('next', pathname + search)
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
