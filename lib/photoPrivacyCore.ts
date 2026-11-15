// lib/photoPrivacyCore.ts
//
// PURE. "Hide my photo from parents" (owner, 17 Oct 2026; stored as
// tutor_profiles.show_avatar = false, PR70). When a tutor hides their photo,
// every surface parents or the public can see shows their INITIALS instead:
// tutor cards, the profile page, search results, share previews and Open Graph
// images, and structured data (the image is left out of JSON-LD). Admin and
// staff always see the real photo, and hiding never skips verification — the
// photo is still uploaded and reviewed as before.

/** The photo a parent or the public may see: null when hidden (or rejected). */
export function publicPhoto(avatarUrl: string | null | undefined, opts: { hidden?: boolean; rejected?: boolean }): string | null {
  if (opts.hidden || opts.rejected) return null
  const v = (avatarUrl ?? '').trim()
  return v ? v : null
}

/** Up to two initials from a name: "Ali Raza" → "AR", "sana" → "S". */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : ''
  return (first + last).toLocaleUpperCase()
}

export const HIDE_PHOTO_LABEL = 'Hide my photo from parents'
export const HIDE_PHOTO_HELP = 'Parents will see a default picture instead. We still need your photo for verification.'

// The photo step's choice (owner, 12 Nov 2026). The upload is required — staff
// match it to the CNIC — and the tutor chooses what parents see. Both choices
// are the same stored setting (tutor_profiles.show_avatar): "default picture"
// = hidden, so the public sees the branded male / female default (neutral for
// a missing gender or Trans) and staff still see and review the real photo.
export const PHOTO_STEP_EXPLAIN = 'Upload a clear photo of your face. Our team uses it to match your CNIC.'
export const SHOW_MY_PHOTO_LABEL = 'Show my photo to parents'
export const SHOW_DEFAULT_PICTURE_LABEL = 'Show a default picture instead'
export const SHOW_DEFAULT_PICTURE_HELP = 'Parents see a default picture. Our team still sees your photo.'
