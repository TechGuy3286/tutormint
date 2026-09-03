import type { MetadataRoute } from 'next'

import { PREVIEW_MODE } from '@/lib/preview'

// robots.txt.
//
// Everything public is crawlable — the browse pages and tutor profiles are the
// platform's entire organic-search surface, and TutorMint has no interest in
// hiding them. What is disallowed is everything that is either private, or a
// crawl trap:
//
//   PRIVATE. /admin, /api, dashboards, messages, the account pages. Crawling
//   these returns a redirect to /login for an anonymous crawler, so nothing
//   leaks either way — but a search result reading "Sign in — TutorMint" for
//   somebody's dashboard URL is a worse result than no result.
//
//   TRAPS. /pay, /messages/<id> and /browse/tuitions?job=... are unbounded or
//   session-specific. A crawler that follows them spends its budget on pages
//   nobody searches for, and that budget comes out of the tutor profiles.
//
// This is not a security control. Disallow is a request, not a boundary; the
// boundary is row-level security and the server-side layout gates. A crawler
// that ignores robots.txt gets a login redirect, not somebody's data.

const BASE = 'https://tutormint.org'

export default function robots(): MetadataRoute.Robots {
  // PREVIEW. While the directory is mostly seed accounts, nothing should be
  // indexed at all: those pages would become the ones that rank, and a real
  // tutor would later compete with a fixture for their own name. The sitemap
  // is withheld too — offering a map of pages we have just asked not to be
  // crawled is a mixed signal, and some crawlers take the sitemap as the
  // stronger one. Flip NEXT_PUBLIC_PREVIEW_MODE=false to restore all of it.
  if (PREVIEW_MODE) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      host: BASE,
    }
  }

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
