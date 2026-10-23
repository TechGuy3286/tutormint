// lib/signupLinks.ts
//
// PURE. Every link into sign-up says which role the form starts on (owner,
// 24 Oct 2026): Tutor is the default, so a tutor link is plain /register; a
// link aimed at parents — every public "Post a tuition", a parent call to
// action, the Parents footer column, and the header's "Join free" on a page
// aimed at parents — opens /register?role=parent.
//
// A public "Post a tuition" goes to sign-up WITH the post form as its
// return-to: a visitor signs up as a parent and lands on the form, and a
// signed-in parent is sent straight on to it (/register redirects a session to
// its `next`).

import { authHref } from '@/lib/returnTo'

export const POST_TUITION_PATH = '/parent/dashboard/post-job'

export const TUTOR_SIGNUP_HREF = '/register'
export const PARENT_SIGNUP_HREF = authHref('/register', null, 'parent')

/** A public "Post a tuition" link, optionally with the post form's query
 *  (city, area) carried through sign-up. */
export function postTuitionHref(query?: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v)
  const next = q.toString() ? `${POST_TUITION_PATH}?${q.toString()}` : POST_TUITION_PATH
  return authHref('/register', next, 'parent')
}

export const POST_TUITION_HREF = postTuitionHref()

/** Pages aimed at parents: finding a tutor, a tutor landing page, a tutor's
 *  public profile, a parent's public card, the parents' plans. */
export function pageAimsAtParents(pathname: string | null | undefined): boolean {
  const p = (pathname ?? '/').replace(/\/+$/, '') || '/'
  if (p === '/browse/tutors' || p.startsWith('/browse/tutors/')) return true
  if (p.startsWith('/tutors/')) return true
  if (/^\/parent\/[0-9a-f-]{36}$/i.test(p)) return true
  const tutorProfile = /^\/tutor\/([^/]+)$/.exec(p)
  if (tutorProfile && !['dashboard', 'onboarding', 'complete-profile', 'packages', 'claim', 'register', 'login', 'verify', 'upload-youtube'].includes(tutorProfile[1])) return true
  return false
}

/** The header's "Join free" for this page. */
export function joinHrefForPath(pathname: string | null | undefined): string {
  return pageAimsAtParents(pathname) ? PARENT_SIGNUP_HREF : TUTOR_SIGNUP_HREF
}
