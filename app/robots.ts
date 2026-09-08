import type { MetadataRoute } from 'next'

// robots.txt.
//
// PUBLIC PAGES ARE CRAWLABLE, INDEXED NOW (owner, 8 Sep 2026). The browse pages,
// tutor profiles, tuition pages, landing pages, blog and the marketing pages are
// the platform's entire organic-search surface, and indexing is opened even
// while the "launching soon" banner is still up — the banner (PreviewBanner) is
// now decoupled from indexing. See "Index now, banner stays" in CLAUDE.md and
// lib/preview.ts.
//
// What stays disallowed is everything that is either private, or a crawl trap:
//
//   PRIVATE. /admin, /api, dashboards, /verify-phone, /verify-email, messages,
//   the account pages. Crawling these returns a login redirect for an anonymous
//   crawler, so nothing leaks — but a result reading "Sign in — TutorMint" for
//   somebody's dashboard URL is a worse result than no result.
//
//   TRAPS. /pay, /messages/<id> and /browse/...?<filters> are unbounded or
//   session-specific. A crawler that follows them spends its budget on pages
//   nobody searches for, and that budget comes out of the tutor profiles.
//
// This is not a security control. Disallow is a request, not a boundary; the
// boundary is row-level security and the server-side layout gates. A crawler
// that ignores robots.txt gets a login redirect, not somebody's data.
//
// The apex permanently redirects to www (next.config.ts), so the canonical host
// — and the Sitemap line — are www, matching lib/siteUrl.

const BASE = 'https://www.tutormint.org'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/api/',
          '/tutor/dashboard',
          '/tutor/complete-profile',
          '/tutor/claim',
          '/parent/dashboard',
          '/parent/verify',
          '/account/',
          '/verify-phone',
          '/verify-email',
          '/messages',
          '/chat/',
          '/pay/',
          '/suspended',
          '/dev/',
          '/login',
          '/register',
          '/forgot-password',
          // Query-string variants of the browse pages: the same tutors in a
          // different order is a duplicate, not a new page.
          '/browse/tutors?',
          '/browse/tuitions?',
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  }
}
