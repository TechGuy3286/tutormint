// lib/inboxTags.ts
//
// The status tag shown beside a member in the admin Team inbox (PR94 Part 3),
// worked out from the step-1 checklist — FIRST MISSING ITEM WINS, in this order:
//   1. Incomplete profile — N%   (the same profiles.profile_completion the tutor
//      dashboard shows — one shared source)
//   2. No WhatsApp number
//   3. Waiting for staff approval (CNIC / photo / selfie uploaded, not yet approved)
//   4. Fee not paid
//   5. complete → no tag
// Parents get a tag ONLY where an equivalent check already exists — CNIC/address
// not verified — and nothing otherwise.
//
// PURE — no imports — so the inbox list and the conversation header render one
// decision, and a test can assert the ordering.

export type InboxTagTone = 'gold' | 'red' | 'navy' | 'teal'

// Each tag names the Team-inbox template staff should reach for (PR105 §6), so
// opening that member's conversation preselects the matching template.
export type InboxTag = { label: string; labelUr: string; tone: InboxTagTone; templateKey: string }

export type MemberTagFacts = {
  role: string | null
  /** profiles.profile_completion (0–100). */
  completion: number
  /** profiles.whatsapp OR tutor_profiles.whatsapp_number is set. */
  hasWhatsapp: boolean
  /** Tutor: CNIC / profile photo / selfie uploaded but not yet approved. */
  awaitingApproval: boolean
  /** The one-time verification fee is paid. */
  feePaid: boolean
  /** Parent: CNIC AND address approved. */
  cnicVerified: boolean
}

export function memberInboxTag(f: MemberTagFacts): InboxTag | null {
  if (f.role === 'tutor') {
    if (f.completion < 100) {
      return { label: `Incomplete profile — ${f.completion}%`, labelUr: `پروفائل نامکمل — ${f.completion}%`, tone: 'gold', templateKey: 'profile_completion_nudge' }
    }
    if (!f.hasWhatsapp) {
      return { label: 'No WhatsApp number', labelUr: 'واٹس ایپ نمبر موجود نہیں', tone: 'red', templateKey: 'no_whatsapp' }
    }
    if (f.awaitingApproval) {
      return { label: 'Waiting for staff approval', labelUr: 'عملے کی منظوری کا انتظار', tone: 'navy', templateKey: 'awaiting_approval' }
    }
    if (!f.feePaid) {
      return { label: 'Fee not paid', labelUr: 'فیس ادا نہیں ہوئی', tone: 'teal', templateKey: 'fee_not_paid' }
    }
    return null
  }
  // Parent / academy: only the verification check has an equivalent (Part 3).
  if (f.role === 'parent' || f.role === 'academy') {
    if (!f.cnicVerified) {
      return { label: 'CNIC not verified', labelUr: 'شناختی کارڈ کی تصدیق نہیں', tone: 'navy', templateKey: 'cnic_unclear' }
    }
    return null
  }
  return null
}

/** Pill classes per tone — every pair is registered in scripts/contrast-check.ts. */
export const INBOX_TAG_CLASS: Record<InboxTagTone, string> = {
  gold: 'bg-tm-tint-gold text-tm-gold-ink',
  red: 'bg-tm-tint-red text-tm-red',
  navy: 'bg-tm-tint-navy text-tm-navy',
  teal: 'bg-tm-tint-teal text-tm-teal-ink',
}
