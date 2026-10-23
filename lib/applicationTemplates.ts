// lib/applicationTemplates.ts
//
// The server half of the Applications templates (owner, 23 Oct 2026,
// Applications v3.1; rules in lib/applicationTemplatesCore).
//
//   loadAppTemplates()   the stored bodies of the Applications group
//   loadSupportWhatsApp() the support number from settings, as a person reads it
//   saveSupportWhatsApp() owner only (the route checks); audited, masked
//
// The support number is the platform's own public line, but it is still
// masked to its last 4 digits in the audit log, like every other number.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { normalisePkMobile } from '@/lib/phone'
import { SUPPORT_WHATSAPP_FALLBACK, formatSupportWhatsApp, normaliseWhatsapp } from '@/lib/supportContacts'
import { APP_TEMPLATE_KEYS, type AppTemplateKey } from '@/lib/applicationTemplatesCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** The settings key the support WhatsApp number lives under. */
export const SUPPORT_WHATSAPP_SETTING = 'support.whatsapp'

/** The stored bodies, by key (a missing row is simply absent → default). */
export async function loadAppTemplates(admin: Admin | null = createAdminClient()): Promise<Map<AppTemplateKey, string>> {
  const out = new Map<AppTemplateKey, string>()
  if (!admin) return out
  try {
    const { data } = await admin.from('admin_message_templates').select('key, body').in('key', [...APP_TEMPLATE_KEYS])
    for (const r of data ?? []) out.set(r.key as AppTemplateKey, (r.body as string | null) ?? '')
  } catch {
    /* every message falls back to its default */
  }
  return out
}

/** The bare MSISDN from settings → env → the one constant. */
export async function loadSupportMsisdn(admin: Admin | null = createAdminClient()): Promise<string> {
  let stored: string | null = null
  if (admin) {
    try {
      const { data } = await admin.from('app_settings').select('value').eq('key', SUPPORT_WHATSAPP_SETTING).maybeSingle()
      stored = (data?.value as string | null) ?? null
    } catch {
      /* fall through */
    }
  }
  return normaliseWhatsapp(stored) ?? normaliseWhatsapp(process.env.SUPPORT_WHATSAPP?.trim() || null) ?? SUPPORT_WHATSAPP_FALLBACK
}

/** "0321 5872222" — what {support_whatsapp} fills with. */
export async function loadSupportWhatsApp(admin: Admin | null = createAdminClient()): Promise<string> {
  return formatSupportWhatsApp(await loadSupportMsisdn(admin))
}

const mask = (msisdn: string | null) => (msisdn ? `•••${msisdn.slice(-4)}` : null)

/** Owner only (the route checks). Stores the canonical 92… form. */
export async function saveSupportWhatsApp(
  actor: AdminActor,
  raw: string,
): Promise<{ ok: true; display: string } | { ok: false; status: 400 | 503; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const msisdn = normalisePkMobile(raw)
  if (!msisdn) return { ok: false, status: 400, error: 'Enter a Pakistani mobile number, e.g. 0321 5872222.' }
  const before = await loadSupportMsisdn(admin)
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: SUPPORT_WHATSAPP_SETTING, value: msisdn, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'settings.support_whatsapp',
    targetType: 'app_settings',
    targetId: SUPPORT_WHATSAPP_SETTING,
    detail: { key: SUPPORT_WHATSAPP_SETTING, before: mask(before), after: mask(msisdn) },
  })
  return { ok: true, display: formatSupportWhatsApp(msisdn) }
}
