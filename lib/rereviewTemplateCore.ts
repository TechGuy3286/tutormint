// lib/rereviewTemplateCore.ts — PURE, client-safe.
//
// The WhatsApp message after the Owner does NOT approve a member's replaced
// profile picture or selfie (owner, 4 Nov 2026). English only. The earlier
// approved one stays on the profile. Editable in Team inbox → Templates →
// "New photo or selfie" (template key `rereview_rejected`, migration 222).

export const REREVIEW_TEMPLATE_KEY = 'rereview_rejected'
export const REREVIEW_PLACEHOLDERS = ['first_name', 'document', 'reason', 'link', 'support_whatsapp'] as const

export const REREVIEW_DEFAULT =
  'Assalam o Alaikum {first_name},\nYour new {document} was not approved: {reason}\nYour earlier approved {document} is still on your profile. You can upload a new one here:\n{link}\n\nNeed help? WhatsApp {support_whatsapp}'

/** The Edit Profile page — where the member uploads again. */
export const REREVIEW_LINK_PATH = '/tutor/dashboard/settings'

export function rereviewDocumentName(item: 'profile_pic' | 'selfie'): string {
  return item === 'selfie' ? 'selfie' : 'profile picture'
}

export function fillRereviewRejected(
  body: string,
  v: { firstName: string; document: string; reason: string; link: string; supportWhatsapp: string },
): string {
  return body
    .split('{first_name}').join(v.firstName.trim() || 'there')
    .split('{document}').join(v.document)
    .split('{reason}').join(v.reason.trim())
    .split('{link}').join(v.link)
    .split('{support_whatsapp}').join(v.supportWhatsapp)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
