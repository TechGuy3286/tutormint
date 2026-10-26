// lib/accountEraseCore.ts
//
// Close account and erase personal data (owner, 27 Oct 2026) — the pure rules.
// The ONE exception to "nothing is deleted": personal data is erased at the
// member's own request. lib/accountErase.ts does the I/O.
//
// What is erased: the name (→ "Deleted user"), phone numbers, emails, CNIC
// number, address, bio, headline, education text and areas; the CNIC images,
// photo, selfie, intro video and receipt images; the contents of their
// messages (→ "[deleted]"); phones and emails inside staff notes about them
// (masked). The auth user is scrubbed so nobody can sign in and the phone and
// email are free again.
//
// What is kept, with no personal details: payment amounts, dates, methods and
// bank references; applications, follow-ups and staff credits (linked to the
// same — now anonymous — id); an Audit line. Counts and revenue do not change.

import { convertedTutorRedirect } from '@/lib/convertAccountCore'
import { scrubPii } from '@/lib/journeyCore'

export const ERASE_GRACE_DAYS = 7
export const ERASED_NAME = 'Deleted user'
export const DELETED_MESSAGE = '[deleted]'
export const ERASE_CONFIRMATION =
  'Your TutorMint account has been closed and your personal data deleted.'

/** The no-mailbox address an erased account is left with — the synthetic domain
 *  every part of the platform already treats as "no email", and it frees the
 *  real address (profiles.email and auth.users.email are unique). */
export function erasedEmail(memberId: string): string {
  return `erased-${memberId}@users.tutormint.org`
}

export function isErasedEmail(address: string | null | undefined): boolean {
  return !!address && /^erased-[0-9a-f-]{36}@users\.tutormint\.org$/i.test(String(address).trim())
}

export type EraseMode = 'later' | 'now'

/** Validation of the owner's request. null = fine. */
export function eraseRequestProblem(r: { reason: string; identityCheck: string; mode: string }): string | null {
  if (r.mode !== 'later' && r.mode !== 'now') return 'Choose when to erase.'
  if (r.reason.trim().length < 3) return 'Write the reason for closing this account.'
  if (r.reason.trim().length > 600) return 'Keep the reason under 600 characters.'
  if (r.identityCheck.trim().length < 3) return 'Say how the person’s identity was confirmed.'
  if (r.identityCheck.trim().length > 300) return 'Keep that under 300 characters.'
  return null
}

/** When an erase requested at `nowMs` is due. "now" = immediately. */
export function eraseDueAt(nowMs: number, mode: EraseMode): Date {
  return new Date(mode === 'now' ? nowMs : nowMs + ERASE_GRACE_DAYS * 24 * 60 * 60 * 1000)
}

/** "Erases in 6 days" / "Erases in 5 hours" / "Erases at the next daily run". */
export function eraseCountdown(dueAtMs: number, nowMs: number): string {
  const left = dueAtMs - nowMs
  if (left <= 0) return 'Due — erases at the next daily run'
  const hours = Math.ceil(left / 3_600_000)
  if (hours < 48) return `Erases in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.ceil(left / 86_400_000)
  return `Erases in ${days} days`
}

/** Pakistan-time date for banners and the audit line: "3 Nov 2026". */
export function pkDate(at: Date | string | number): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

/** The member's banner while an erase is scheduled. */
export function pendingBannerText(dueAt: Date | string): string {
  return `Your account will be deleted on ${pkDate(dueAt)}`
}

/** The Audit line (owner's wording). */
export function eraseAuditLine(o: { reason: string; byName: string; at: Date | string }): string {
  return `Account erased on request · ${o.reason.trim()} · by ${o.byName.trim() || 'Owner'} · ${pkDate(o.at)}`
}

/** Who may be erased: a tutor or parent account, not staff, not already erased. */
export function eraseTargetProblem(
  p: { role: string | null; admin_role: string | null; erased_at: string | null } | null,
  opts: { retry?: boolean } = {},
): string | null {
  if (!p) return 'That member was not found.'
  // A run that failed part-way left erased_at set; it may run again.
  if (p.erased_at && !opts.retry) return 'This account’s data was already erased.'
  if (p.admin_role) return 'A staff account cannot be erased here. Remove their staff access first.'
  if (p.role !== 'tutor' && p.role !== 'parent' && p.role !== 'academy') return 'Only a tutor or a parent account can be erased.'
  return null
}

export type ErasureState = { status: 'scheduled' | 'cancelled' | 'done' | 'failed'; dueAtMs: number }

/** Should the daily run erase this now? */
export function eraseIsDue(e: ErasureState, nowMs: number): boolean {
  return e.status === 'scheduled' && e.dueAtMs <= nowMs
}

/** A scheduled erase can be cancelled until it has run. */
export function eraseCancellable(e: ErasureState | null): boolean {
  return !!e && e.status === 'scheduled'
}

// ------------------------------------------------------------ what is cleared

/** profiles: the patch the erase writes. Keeps role, city, dates, statuses,
 *  utm, verification and fee facts (so counts and revenue are unchanged). */
export function profileErasePatch(memberId: string, nowIso: string): Record<string, unknown> {
  return {
    full_name: ERASED_NAME,
    email: erasedEmail(memberId),
    phone_number: '',
    whatsapp: null,
    secondary_phone: null,
    cnic_number: null,
    cnic_image_path: null,
    address: null,
    area: null,
    avatar_url: null,
    linked_account_id: null,
    phone_verified_at: null,
    email_pending_confirm: false,
    email_opt_out: true,
    match_email_opt_out: true,
    // Out of every work list (Follow-ups, Paid tutors…) and the directory, and
    // its tuitions hidden; People still counts the account, so totals hold.
    is_suspended: true,
    suspended_at: nowIso,
    suspension_reason: 'Account erased on request',
    erased_at: nowIso,
  }
}

/** The profile fields the erase empties — for tests and the admin summary. */
export const PROFILE_FIELDS_CLEARED = ['full_name', 'email', 'phone_number', 'whatsapp', 'secondary_phone', 'cnic_number', 'cnic_image_path', 'address', 'area', 'avatar_url'] as const

/** tutor_profiles: the patch. The slug becomes a neutral one (the old one holds
 *  the name), locked so the name trigger does not re-derive it. */
export function tutorErasePatch(memberId: string): Record<string, unknown> {
  return {
    full_name: ERASED_NAME,
    email: erasedEmail(memberId),
    phone_number: null,
    whatsapp_number: null,
    headline: null,
    bio: null,
    area: null,
    degrees: [],
    certifications: [],
    specialty_subjects: null,
    specialty_list: null,
    avatar_url: null,
    cover_image_url: null,
    cnic_front_url: null,
    cnic_back_url: null,
    selfie_url: null,
    video_intro_url: null,
    experience_letter_url: null,
    video_youtube_id: null,
    video_status: 'none',
    show_avatar: false,
    slug: erasedSlug(memberId),
    slug_locked: true,
  }
}

export const TUTOR_FIELDS_CLEARED = ['full_name', 'email', 'phone_number', 'whatsapp_number', 'headline', 'bio', 'area', 'degrees', 'certifications', 'avatar_url', 'selfie_url', 'cnic_front_url', 'cnic_back_url', 'video_intro_url', 'video_youtube_id'] as const

export function erasedSlug(memberId: string): string {
  return `deleted-${memberId.replace(/-/g, '').slice(0, 10)}`
}

/** A slug as compared for the 301: lower case, trimmed. Hash it with sha256. */
export function normaliseSlug(slug: string): string {
  return decodeURIComponent(slug).trim().toLowerCase()
}

/** Where an erased tutor's old address goes: Find tutors for their city. */
export function erasedTutorTarget(city: string | null | undefined): string {
  return convertedTutorRedirect(city)
}

// ------------------------------------------------------------------- storage

export type StoredFile = { bucket: string; path: string }

const BUCKETS = ['avatars', 'tutor-media', 'identity-docs', 'payment-proofs', 'message-media'] as const
export const ERASE_BUCKETS: readonly string[] = BUCKETS

/** A public storage URL → its bucket and path, for our own Supabase host only. */
export function storageFileFromUrl(url: string | null | undefined): StoredFile | null {
  if (!url) return null
  const m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/.exec(String(url))
  if (!m) return null
  return { bucket: m[1], path: decodeURIComponent(m[2]) }
}

/** Every stored file the erase removes, de-duplicated. Folder listings under
 *  the member's own id are added by the I/O side. */
export function filesToRemove(f: {
  documents: { original_path: string | null; preview_path: string | null }[]
  receipts: { screenshot_path: string | null; refund_proof_path: string | null }[]
  messageAttachments: (string | null)[]
  publicUrls: (string | null)[]
}): StoredFile[] {
  const out = new Map<string, StoredFile>()
  const add = (bucket: string, path: string | null | undefined) => {
    if (!path) return
    const p = String(path).replace(/^\/+/, '')
    if (!p) return
    out.set(`${bucket}:${p}`, { bucket, path: p })
  }
  for (const d of f.documents) {
    add('identity-docs', d.original_path)
    add('identity-docs', d.preview_path)
  }
  for (const r of f.receipts) {
    add('payment-proofs', r.screenshot_path)
    add('payment-proofs', r.refund_proof_path)
  }
  for (const a of f.messageAttachments) add('message-media', a)
  for (const u of f.publicUrls) {
    const s = storageFileFromUrl(u)
    if (s) add(s.bucket, s.path)
  }
  return [...out.values()]
}

// ---------------------------------------------------------------- text scrubs

/** Staff notes and free text about the member: phones, CNICs and emails masked. */
export function maskNote(text: string | null | undefined): string {
  return scrubPii(String(text ?? ''))
}

const PII_KEY = /name|email|mail|mobile|phone|msisdn|cnic|address|cell|contact/i

/** A gateway payload with every personal field removed, recursively. Amounts,
 *  dates, statuses and references stay. */
export function scrubPaymentRaw(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(scrubPaymentRaw)
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (PII_KEY.test(k)) continue
      out[k] = scrubPaymentRaw(v)
    }
    return out
  }
  if (typeof raw === 'string') return scrubPii(raw)
  return raw
}

// ----------------------------------------------------------------- auth user

/** Tables that must survive an erase and are ON DELETE CASCADE from auth.users
 *  (checked live on 27 Oct 2026). Deleting the auth user would take them. */
export const KEPT_CASCADE_TABLES = ['payments', 'applications', 'application_follow_ups', 'member_follow_ups', 'jobs', 'profiles', 'tutor_profiles', 'subscriptions', 'member_notes'] as const

/** Delete the auth user, or scrub it? Scrub whenever deleting would cascade into
 *  something the erase must keep. */
export function authUserDecision(cascadeTables: readonly string[]): 'delete' | 'scrub' {
  return cascadeTables.some((t) => (KEPT_CASCADE_TABLES as readonly string[]).includes(t)) ? 'scrub' : 'delete'
}

// ------------------------------------------------------------- self-serve

/** May this member request "Delete my account"? They confirm with a code sent
 *  to their verified mobile; without one, support does it. */
export function selfDeleteProblem(p: { phoneVerified: boolean; phone: string | null; isStaff: boolean; erased: boolean }): string | null {
  if (p.erased) return 'This account was already deleted.'
  if (p.isStaff) return 'Staff accounts are closed by the Owner.'
  if (!p.phoneVerified || !p.phone) return 'Verify your mobile number first, or ask support on WhatsApp 0321 5872222 to delete your account.'
  return null
}
