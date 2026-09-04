// Preview mode: ONE flag, read in three places.
//
// WHY IT EXISTS. The public directory is currently almost entirely seed
// accounts — invented ratings, invented fees, tutors who will never reply. If
// Google indexes those now they become the pages that rank later, and the
// first real tutor to complete a profile competes with a fixture for their own
// name. Ranking is slow to earn and slow to correct, so the cheap move is not
// to be indexed until there is something worth indexing.
//
// The banner is the honest half of the same decision. A visitor who finds the
// site early should be told what they are looking at rather than concluding
// that a network of six tutors is the finished product.
//
// ONE CONDITION, NOT SCATTERED. Everything keys on this single export:
//
//   app/layout.tsx    the robots meta tag on every page
//   app/robots.ts     Disallow: / for every crawler
//   components/PreviewBanner.tsx  the banner itself
//
// Turning it off is setting NEXT_PUBLIC_PREVIEW_MODE=false in Vercel and
// redeploying. Nothing else changes, and nothing has to be found first.
//
// DEFAULT ON, deliberately. An unset variable means preview: forgetting to set
// it costs a few weeks of indexing that can be recovered, where forgetting to
// unset a "launched" default means indexing the fixtures, which cannot be.
// The flag has to be turned OFF on purpose, by somebody who has looked.
//
// NEXT_PUBLIC_ because the banner renders in the browser. There is nothing
// secret in it — the whole point is that visitors and crawlers can both see
// the site is in preview.

export const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE !== 'false'

/** What the banner says. Kept here so the copy travels with the flag. */
export const PREVIEW_NOTICE = "We're launching soon. What you see here is a preview."
