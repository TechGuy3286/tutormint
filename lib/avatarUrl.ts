// lib/avatarUrl.ts
//
// What may be stored in an avatar column.
//
// TWO THINGS THIS REFUSES, and they are different problems with one answer.
//
// A `data:` URI. Three members had one — 4,041,714 characters for the largest
// — and profiles.avatar_url is read by getSessionUser() on every request and
// rendered by the header, every card and every message row, so those bytes
// were inlined into the HTML of every page that showed that person.
// Uncacheable, re-sent on every navigation, and invisible to next/image: no
// resize, no WebP, no intrinsic size. The rows were moved into storage by
// scripts/migrate-data-uri-avatars.ts; this is what stops the next one.
//
// An arbitrary http(s) URL. /api/parent/profile already refused these, and for
// a reason that applies just as strongly to a tutor: an avatar is rendered on
// public cards, so a URL pointing at somebody else's server is a beacon that
// fires for every parent who scrolls past. The tutor route had no check at
// all, which is the writer that let a data URI in.
//
// Only a public object in one of our own buckets is accepted.

const ALLOWED_BUCKETS = ['avatars', 'tutor-media'] as const

/** True when `url` is a public object in one of our storage buckets. */
export function isOurStorageUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return false
  return ALLOWED_BUCKETS.some((b) => url.startsWith(`${base}/storage/v1/object/public/${b}/`))
}

/** The one message a member ever sees for a rejected picture. */
export const BAD_AVATAR_MESSAGE = 'That picture could not be saved. Please upload it again.'
