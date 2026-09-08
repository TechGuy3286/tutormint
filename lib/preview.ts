// Preview mode: the "launching soon" BANNER only.
//
// DECOUPLED FROM INDEXING (owner, 8 Sep 2026). This flag once drove three
// things at once — the banner, a site-wide robots noindex meta, and
// `Disallow: /` in robots.txt. The owner decided to index the public pages NOW,
// while the banner stays up, so those two SEO halves are gone: `app/robots.ts`
// always serves the public rules (private paths still disallowed),
// `app/layout.tsx` sets no site-wide noindex, and `app/sitemap.ts` always lists
// tutors/tuitions. This flag now controls exactly one thing:
//
//   components/PreviewBanner.tsx  the banner itself
//
// The banner is still the honest note that the directory is early; it just no
// longer keeps the site out of search. Set NEXT_PUBLIC_PREVIEW_MODE=false in
// Vercel to remove the banner. NEXT_PUBLIC_ because it renders in the browser.

export const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE !== 'false'

/** What the banner says. Kept here so the copy travels with the flag. */
export const PREVIEW_NOTICE = "We're launching soon. What you see here is a preview."
