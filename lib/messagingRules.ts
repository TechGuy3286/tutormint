// lib/messagingRules.ts
//
// The pure rules of Messaging part 2 — no DB, no server-only — so the visibility
// and gating decisions can be unit-tested (scripts/test-messaging.ts) and shared
// by the server and the client without either owning a copy.
//
// Three of them are security decisions and each has a test:
//   * a message "deleted for me" is invisible to that reader, and only them;
//   * a photo attachment is served only to a participant of its thread;
//   * the paperclip is enabled only for a member whose entitlement already lets
//     them see the other party's contact details — the SAME check, no new rule.

export const MAX_QUICK_REPLIES = 6
const QUICK_REPLY_MAX_LEN = 120

/** The out-of-the-box quick replies a tutor starts with (editable in Settings). */
export const DEFAULT_QUICK_REPLIES: string[] = [
  "I'm available for a demo",
  'Which area are you in?',
  "What's the monthly budget?",
  'Yes, I teach online too',
  'When would you like to start?',
]

/** Clean a quick-reply list from any source: trim, drop empties, cap length and count. */
export function sanitizeQuickReplies(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : []
  const out: string[] = []
  for (const raw of arr) {
    if (typeof raw !== 'string') continue
    const v = raw.trim().replace(/\s+/g, ' ').slice(0, QUICK_REPLY_MAX_LEN)
    if (v.length > 0) out.push(v)
    if (out.length >= MAX_QUICK_REPLIES) break
  }
  return out
}

// ---- deleted-for-me --------------------------------------------------------

/**
 * Is a message visible to this reader? A "delete for me" appends the deleter's
 * id to `deleted_for`; the row is never removed (there is no delete-for-everyone),
 * so it stays visible to the OTHER participant and disappears only for the
 * deleter. This is the filter the read path applies.
 */
export function messageVisibleTo(
  msg: { deletedFor?: string[] | null },
  userId: string,
): boolean {
  return !(msg.deletedFor ?? []).includes(userId)
}

// ---- attachments -----------------------------------------------------------

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
export const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png'] as const

/** JPG/PNG up to 5 MB — the only thing the paperclip accepts. */
export function isAllowedAttachment(type: string, bytes: number): boolean {
  return (
    (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(type) &&
    Number.isFinite(bytes) &&
    bytes > 0 &&
    bytes <= ATTACHMENT_MAX_BYTES
  )
}

/**
 * May this member attach a photo? Exactly when their entitlement already lets
 * them see the other party's contact details — no new rule. A member who cannot
 * see contact details cannot send a photo either; they get the disabled
 * paperclip and the standard upsell.
 */
export function mayAttachPhoto(ent: { canViewContact: boolean }): boolean {
  return ent.canViewContact
}

/** May this member view an attachment? Only a participant of its thread. */
export function isThreadParticipant(
  thread: { participant_a: string; participant_b: string },
  userId: string,
): boolean {
  return thread.participant_a === userId || thread.participant_b === userId
}

// ---- list preview ----------------------------------------------------------

/** The one-line preview for the conversation list: "Photo" for a bare attachment. */
export function previewText(body: string, hasAttachment: boolean): string {
  const b = (body ?? '').trim()
  if (b.length > 0) return b
  if (hasAttachment) return 'Photo'
  return ''
}
