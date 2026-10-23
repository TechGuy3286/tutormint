// lib/adminWhatsAppCore.ts
//
// PURE, client-safe. The ONE message builder behind every admin WhatsApp
// button that opens a chat with a member (owner, 20 Oct 2026). Before this,
// the Overview cards (Documents to approve and every other list), the member
// page's Contact → WhatsApp, the People rows, Verification → Tutors and the
// tutor record opened WhatsApp with an EMPTY message; only Follow-ups and My
// sign-ups pre-filled one.
//
// Which message:
//   parent                     → parent help
//   tutor, a document rejected → re-upload <document> (<reason>)
//   tutor, a document waiting  → "thanks for uploading … next step is …"
//   tutor, everything done and the fee paid → a plain "how can we help"
//   tutor, otherwise           → the Follow-ups state messages (started
//                                payment, docs done & fee due, next step)
//   anyone else                → a plain "how can we help"
//
// The link is https://api.whatsapp.com/send?phone=<92…>&text=<encoded text>
// (lib/waLinkCore waSendHref) — wa.me turns every emoji into "�" on its
// redirect (23 Oct 2026). Android, iPhone, Desktop and Web all open it.
//
// Unit-tested by scripts/test-admin-whatsapp.ts.

import { normalisePkMobile } from '@/lib/phone'
import { finishWaText, siteLink, waSendHref } from '@/lib/waLinkCore'
import {
  DOC_WORD,
  firstNameOf,
  followUpMessage,
  joinAnd,
  nextPhrase,
  type MessageType,
  type RejectedDoc,
  type TutorFollowFacts,
} from '@/lib/tutorFollowUpCore'

export type AdminMessageType = MessageType | 'docs_waiting' | 'doc_rejected' | 'parent_help' | 'member_help'

export const DASHBOARD_LINK = siteLink('/tutor/dashboard')

/** api.whatsapp.com/send?phone=92…&text=… — or null with no usable number or no text. The
 *  number may be typed any way (+92, 0300-…, spaces); it is reduced to 92…. */
export function adminWaLink(rawNumber: string | null | undefined, text: string | null | undefined, refCode?: string | null): string | null {
  const msisdn = normalisePkMobile(rawNumber)
  const body = finishWaText(text ?? '', refCode)
  if (!msisdn || !body) return null
  return waSendHref(msisdn, body)
}

export function documentsWaitingMessage(name: string, phrase: string): string {
  return `Assalam o Alaikum ${firstNameOf(name)}, thanks for uploading your documents. We're checking them now. Meanwhile, your next step is to ${phrase}. Reply here if you need help. 🙂\n\n${DASHBOARD_LINK}`
}

export function documentRejectedMessage(name: string, rejected: RejectedDoc[]): string {
  const docs = joinAnd([...new Set(rejected.map((r) => DOC_WORD[r.doc]))])
  const reasons = [...new Set(rejected.map((r) => (r.reason ?? '').trim().replace(/[.\s]+$/, '')).filter(Boolean))]
  return `Assalam o Alaikum ${firstNameOf(name)}, please re-upload your ${docs}${reasons.length ? ` (${reasons.join('; ')})` : ''}. Reply here if you need help. 🙂\n\n${DASHBOARD_LINK}`
}

export function parentHelpMessage(name: string): string {
  return `Assalam o Alaikum ${firstNameOf(name)}, this is TutorMint. Do you need any help finding a tutor? Reply here. 🙂`
}

export function memberHelpMessage(name: string): string {
  return `Assalam o Alaikum ${firstNameOf(name)}, this is TutorMint. Do you need any help? Reply here. 🙂`
}

export type AdminMessageInput = {
  role: 'tutor' | 'parent' | 'other'
  name: string
  /** Tutors only. */
  tutor?: {
    facts: TutorFollowFacts
    /** CNIC, photo or selfie is uploaded and waiting for a decision. */
    docsWaiting: boolean
    /** A plan checkout's stored payment_not_finished text, already filled. */
    planMessage?: string | null
  } | null
  nowMs: number
}

export function adminMemberMessage(input: AdminMessageInput): { text: string; type: AdminMessageType } {
  if (input.role === 'parent') return { text: parentHelpMessage(input.name), type: 'parent_help' }
  const t = input.tutor
  if (input.role !== 'tutor' || !t) return { text: memberHelpMessage(input.name), type: 'member_help' }
  const f = t.facts
  if (f.rejected.length > 0) return { text: documentRejectedMessage(input.name, f.rejected), type: 'doc_rejected' }
  if (t.docsWaiting) return { text: documentsWaitingMessage(input.name, nextPhrase(f)), type: 'docs_waiting' }
  if (f.feePaid && !f.stoppedStep && !f.startedPayment) return { text: memberHelpMessage(input.name), type: 'member_help' }
  const m = followUpMessage(f, input.name, input.nowMs, t.planMessage)
  return { text: m.text, type: m.type }
}

/** Where a button points: the server route that builds the message for this
 *  member, logs the tap and opens WhatsApp. `from` names the screen. */
export function adminWhatsAppRoute(memberId: string, from: string): string {
  return `/api/admin/whatsapp?memberId=${encodeURIComponent(memberId)}&from=${encodeURIComponent(from)}`
}

export const WHATSAPP_FROM = ['overview', 'member', 'people', 'tutor_queue', 'tutor_record'] as const
export type WhatsAppFrom = (typeof WHATSAPP_FROM)[number]
export function parseWhatsAppFrom(v: string | null | undefined): WhatsAppFrom | null {
  return (WHATSAPP_FROM as readonly string[]).includes(v ?? '') ? (v as WhatsAppFrom) : null
}
