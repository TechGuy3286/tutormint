import 'server-only'

// lib/documentsApproved.ts
//
// The "your documents are approved" WhatsApp for one tutor (owner, 15 Oct
// 2026): the right template (fee paid or not), filled with the tutor's first
// name and the right link, as a wa.me link to their WhatsApp (else mobile).
// Staff press send in their own WhatsApp; the click is logged as a follow-up.
// The rules are pure in lib/documentsApprovedCore.

import { createAdminClient } from '@/lib/supabase/admin'
import { SITE_URL } from '@/lib/siteUrl'
import { normalisePkMobile } from '@/lib/phone'
import {
  DOCUMENTS_APPROVED_FALLBACK,
  documentsApprovedKey,
  fillDocumentsApproved,
  waMeHref,
} from '@/lib/documentsApprovedCore'

export type DocumentsApprovedMessage =
  | { ok: true; templateKey: string; text: string; href: string | null; feePaid: boolean }
  | { ok: false; status: number; error: string }

export async function documentsApprovedMessage(tutorId: string): Promise<DocumentsApprovedMessage> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }

  const [{ data: p }, { data: tp }] = await Promise.all([
    admin.from('profiles').select('role, full_name, whatsapp, phone_number').eq('id', tutorId).maybeSingle(),
    admin.from('tutor_profiles').select('slug, verified_fee_paid_at').eq('id', tutorId).maybeSingle(),
  ])
  if (!p || p.role !== 'tutor') return { ok: false, status: 404, error: 'That is not a tutor account.' }

  const feePaid = !!tp?.verified_fee_paid_at
  const templateKey = documentsApprovedKey(feePaid)
  const { data: tpl } = await admin.from('admin_message_templates').select('body').eq('key', templateKey).maybeSingle()
  const body = ((tpl?.body as string | null) ?? '').trim() || DOCUMENTS_APPROVED_FALLBACK[templateKey]

  const slug = (tp?.slug as string | null) ?? null
  const text = fillDocumentsApproved(body, {
    name: (p.full_name as string | null) ?? '',
    payLink: `${SITE_URL}/pay/choose?plan=verified`,
    profileLink: slug ? `${SITE_URL}/tutor/${slug}` : null,
  })
  const msisdn = normalisePkMobile((p.whatsapp as string | null) ?? '') ?? normalisePkMobile((p.phone_number as string | null) ?? '')
  return { ok: true, templateKey, text, href: waMeHref(msisdn, text), feePaid }
}
