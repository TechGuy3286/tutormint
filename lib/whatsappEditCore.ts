// lib/whatsappEditCore.ts — PURE, client-safe (owner, 4 Nov 2026).
//
// Staff set or change a tutor's or parent's WhatsApp number from the member
// page's Edit tab. The rules:
//   • a reason is required (at least 3 characters);
//   • any common Pakistani format is accepted and stored normalised
//     (lib/phone normalisePkMobile → 923001234567);
//   • only tutor and parent accounts; the sign-in mobile is never touched
//     (it stays locked — this edits profiles.whatsapp only);
//   • the Do not use / On hold check happens in the route (it needs the lists).
// Rights: SCREEN_ACCESS.memberWhatsappEdit — admin, operations, the Partner,
// Backend Support, Managers (withSupervisor) and the Owner; Tuitions staff
// cannot.

import { normalisePkMobile } from '@/lib/phone'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'

export const WHATSAPP_REASON_MIN = 3
export const WHATSAPP_REASON_NEEDED = 'Please give a reason for this change.'
export const WHATSAPP_INVALID = 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.'

export type WhatsappEditDecision =
  | { ok: true; msisdn: string; unchanged: boolean }
  | { ok: false; status: number; error: string }

export function whatsappEditDecision(input: {
  targetRole: string | null | undefined
  raw: string | null | undefined
  reason: string | null | undefined
  current: string | null | undefined
}): WhatsappEditDecision {
  if (!['tutor', 'parent', 'academy'].includes(String(input.targetRole ?? ''))) {
    return { ok: false, status: 404, error: 'This is not a tutor or parent account.' }
  }
  if ((input.reason ?? '').trim().length < WHATSAPP_REASON_MIN) return { ok: false, status: 400, error: WHATSAPP_REASON_NEEDED }
  const msisdn = normalisePkMobile(input.raw ?? '')
  if (!msisdn) return { ok: false, status: 400, error: WHATSAPP_INVALID }
  return { ok: true, msisdn, unchanged: normalisePkMobile(input.current ?? '') === msisdn }
}

/** How a WhatsApp number is written to history, Audit and the timeline. */
export function maskWhatsapp(raw: string | null | undefined): string | null {
  return raw ? maskPhoneDisplay(raw) : null
}
