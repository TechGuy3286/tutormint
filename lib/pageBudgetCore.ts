// lib/pageBudgetCore.ts — PURE (owner, 2 Nov 2026, push 2 phone speed).
// The JavaScript a phone downloads before a public page can respond, per page,
// worked out from the build: Next's root files (React, the router) plus every
// chunk the page's client manifest lists for its layouts and the page itself.
// Sizes are gzip (what travels over 4G). scripts/test-phone-budget.ts fails a
// build that goes over these budgets.

export type BudgetPage = { name: string; route: string; manifest: string }

/** The public pages measured on a phone, with their build manifest. */
export const BUDGET_PAGES: BudgetPage[] = [
  { name: 'Homepage', route: '/', manifest: '(site)/page' },
  { name: 'Browse tutors', route: '/browse/tutors', manifest: '(site)/browse/tutors/page' },
  { name: 'Browse tuitions', route: '/browse/tuitions', manifest: '(site)/browse/tuitions/page' },
  { name: 'Tuition page', route: '/tuitions/[city]/[slug]', manifest: '(site)/tuitions/[city]/[slug]/page' },
  { name: 'Tutor profile', route: '/tutor/[slug]', manifest: '(site)/tutor/[slug]/page' },
  { name: 'City tuition page', route: '/tuition-jobs/[city]', manifest: '(site)/tuition-jobs/[city]/page' },
  { name: 'Female jobs page', route: '/tuition-jobs/[city]/[variant]', manifest: '(site)/tuition-jobs/[city]/[variant]/page' },
  { name: 'Post a tuition', route: '/post-tuition', manifest: '(site)/post-tuition/page' },
]

/** Compressed KB a page may load before it can respond. React + Next's router
 *  alone are ~130 KB; the rest is the site's own shared parts and the page. */
export const PAGE_JS_BUDGET_KB = 220

/** A module that must never reach a public page's first load: Node's crypto
 *  polyfill (asn1 "EncoderBuffer"), pulled in by any client import of a file
 *  that imports node:crypto. */
export const FORBIDDEN_MARKERS = ['EncoderBuffer', 'DecoderBuffer overrun']

/** The chunk files of a page: root files + every entry the manifest lists. */
export function pageChunks(rootMainFiles: string[], entryJSFiles: Record<string, string[]>): string[] {
  const out = new Set<string>(rootMainFiles)
  for (const files of Object.values(entryJSFiles)) for (const f of files) out.add(f)
  return [...out]
}

export function overBudget(kb: number, budget = PAGE_JS_BUDGET_KB): boolean {
  return kb > budget
}
