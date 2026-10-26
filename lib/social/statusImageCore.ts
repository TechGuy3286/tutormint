// lib/social/statusImageCore.ts — PURE, client-safe.
//
// The "I'm a Verified Tutor" WhatsApp status image (owner, 26 Oct 2026): the
// existing design at Story size (1080 × 1920), for tutors who pass the Social
// posts verified rule only (Verification Fee paid; CNIC, photo and selfie
// approved — lib/social/eligibilityCore). A hidden photo is the grey silhouette.
//
// Staff send it from the tutor's admin page and their Paid tutors row: the PNG
// downloads, WhatsApp opens to the tutor with the message below (NO link in it,
// ever — link placeholders are blocked and any address typed into the template
// is removed), and a follow-up is recorded with the usual 10-second Undo.

export const STATUS_IMAGE_TEMPLATE_KEY = 'status_image_verified' as const

/** Seeded by migration 201 with exactly this text. */
export const STATUS_IMAGE_DEFAULT =
  "Congratulations {tutor_first_name}, you're now a Verified Tutor on TutorMint ✓ Please post this on your WhatsApp status."

/** The only placeholder this template may use — every link placeholder is unknown, so blocked. */
export const STATUS_PLACEHOLDERS = ['tutor_first_name'] as const

export const STATUS_PLACEHOLDER_HELP: Record<(typeof STATUS_PLACEHOLDERS)[number], string> = {
  tutor_first_name: "The tutor's first name",
}

/** The hint shown after the image downloads. */
export const STATUS_ATTACH_HINT = 'Attach the downloaded image in WhatsApp'

/** The follow-up's source on member_follow_ups. */
export const STATUS_FOLLOW_UP_SOURCE = 'status_image' as const

/** A web address or a bare domain anywhere in the text. */
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|com|pk|net|io|co|app|me|ly)(?:\/\S*)?/gi

export function hasLink(text: string): boolean {
  LINK_RE.lastIndex = 0
  return LINK_RE.test(text)
}

/** The message: the first name filled in, any link removed, spaces tidied. */
export function fillStatusMessage(body: string, firstName: string): string {
  const name = (firstName ?? '').replace(/\s+/g, ' ').trim() || 'there'
  const filled = (body.trim() || STATUS_IMAGE_DEFAULT).replace(/\{tutor_first_name\}/g, name)
  return filled
    .replace(LINK_RE, '')
    .replace(/\{[a-z_]+\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?])/g, '$1')
    .trim()
}

/** The template save check's extra rule: no link in the text itself. */
export function statusSaveProblem(body: string): string | null {
  return hasLink(body) ? 'This message must not contain a link. Remove the web address.' : null
}

/** The file name the PNG downloads as. */
export function statusImageFileName(name: string): string {
  const safe = (name ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Tutor'
  return `${safe}-Verified-Tutor-Status.png`
}

/**
 * How the tutor's "Share on WhatsApp Status" button shares: the phone's share
 * sheet with the image attached when the browser can share files, else a
 * download with one line of instructions.
 */
export type ShareMode = 'share-sheet' | 'download'
export function shareMode(env: { canShareFiles: boolean }): ShareMode {
  return env.canShareFiles ? 'share-sheet' : 'download'
}

/** The one line shown after the download fallback. */
export const SHARE_FALLBACK_LINE =
  'Image saved. Open WhatsApp → Status → add the image from your photos.'

/** The one-time dashboard card. */
export const VERIFIED_CARD_TITLE = "You're verified! Share it on your status"
