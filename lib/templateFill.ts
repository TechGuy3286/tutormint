// lib/templateFill.ts
//
// PURE, client-safe. The last pass every template send path runs (owner,
// 28 Oct 2026 — the simple-English rewrite). The rewritten templates use the
// same few placeholders everywhere:
//
//   {first_name}        the member's first name
//   {link} / {continue_link} / {pay_link}   the one link the message carries
//   {support_whatsapp}  our support WhatsApp number (from settings)
//
// Older send paths (the Team inbox compose box, My sign-ups, the started-payment
// message, documents approved, the seeded-tuition message…) only filled their
// own placeholders. This pass fills whichever of these are still left, so a
// template approved in Team inbox → Templates → Review new wording works on
// every path that sends it. A placeholder the path already filled is gone, so
// nothing is filled twice; one the pass does not know is left as written.

import { SUPPORT_WHATSAPP_FALLBACK, formatSupportWhatsApp } from '@/lib/supportContacts'

/** "0321 5872222" — used when a path has no setting value to hand. */
export const SUPPORT_WHATSAPP_DISPLAY_FALLBACK = formatSupportWhatsApp(SUPPORT_WHATSAPP_FALLBACK)

/** The first word of a name, or "there". */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there'
}

export type CommonFill = {
  /** A full or first name; only the first word is used. */
  name?: string | null
  /** The one link: fills {link}, {continue_link} and {pay_link} when still present. */
  link?: string | null
  /** The support number as shown ("0321 5872222"); the fallback when absent. */
  supportWhatsapp?: string | null
}

/** Fill the common placeholders that are still in the text. */
export function completeCommon(text: string, v: CommonFill): string {
  const first = firstNameOf(v.name)
  const support = (v.supportWhatsapp ?? '').trim() || SUPPORT_WHATSAPP_DISPLAY_FALLBACK
  let out = text.replace(/\{first_name\}/g, first).replace(/\{support_whatsapp\}/g, support)
  if (v.link) out = out.replace(/\{(?:link|continue_link|pay_link)\}/g, v.link)
  return out
}
