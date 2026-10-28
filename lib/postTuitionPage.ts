// lib/postTuitionPage.ts
//
// PURE. The public "Post your tuition" page (owner, 28 Oct 2026). Every parent
// message that asks someone to post a tuition links here, never to a sign-in or
// dashboard address: the page explains the three steps, and its one button
// takes a signed-out visitor to sign-up with Parent selected (then straight to
// the post form), and a signed-in parent straight to the form.

import { POST_TUITION_HREF, POST_TUITION_PATH } from '@/lib/signupLinks'

/** The page's own public address — what templates link to. */
export const POST_TUITION_PUBLIC_PATH = '/post-tuition'

/** The link-preview image (1200×630, app/og/post-tuition/route.tsx). */
export const POST_TUITION_OG_IMAGE = '/og/post-tuition'

export const POST_TUITION_HEADING = 'Post your tuition for free'
export const POST_TUITION_OG_TITLE = 'Post your tuition for free | TutorMint'
export const POST_TUITION_DESCRIPTION =
  'Tell us the class, subjects and area. Verified tutors apply and you choose. Posting is free on TutorMint.'
export const POST_TUITION_STEPS = [
  'Tell us the class and subjects.',
  'Add your city and area.',
  'Verified tutors apply and you choose.',
] as const
export const POST_TUITION_BUTTON = 'Post your tuition'

/** Where the button goes: a signed-in parent straight to the form; anyone
 *  else (signed out, or another kind of account) to sign-up with Parent
 *  selected and the form as the return-to. */
export function postTuitionButtonHref(role: string | null | undefined): string {
  return role === 'parent' ? POST_TUITION_PATH : POST_TUITION_HREF
}
