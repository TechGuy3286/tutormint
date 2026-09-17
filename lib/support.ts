// lib/support.ts
//
// How to reach a human.
//
// Same pattern as lib/payments/manual.ts: app_settings first so the owner can
// change the number without a deploy, environment variable second so a fresh
// checkout works, and null last. A channel with no details configured is not
// offered rather than rendered as an empty link — a WhatsApp button that opens
// wa.me/ with no number is worse than no button, because the member thinks
// they have tried.
//
// Nothing is hardcoded here. CLAUDE.md rule 7 rules out shipping a phone number
// or an email address in page source, and support contacts are exactly the kind
// of thing that changes without anyone thinking to open a code editor.

import { createClient } from '@/lib/supabase/server'
import {
  SUPPORT_WHATSAPP_FALLBACK,
  SUPPORT_EMAIL_FALLBACK,
  normaliseWhatsapp,
  whatsappHref,
} from '@/lib/supportContacts'

// The constants and pure formatters live in lib/supportContacts (client-safe);
// re-exported here so existing server imports (`from '@/lib/support'`) keep
// working and the owner-overridable readers stay server-side.
export {
  SUPPORT_WHATSAPP_FALLBACK,
  SUPPORT_EMAIL_FALLBACK,
  SUPPORT_WHATSAPP_DISPLAY,
  SUPPORT_PHONE_SCHEMA,
  whatsappHref,
  formatSupportWhatsApp,
  formatSupportPhoneSchema,
} from '@/lib/supportContacts'

const KEYS = {
  whatsapp: 'support.whatsapp',
  email: 'support.email',
  hours: 'support.hours',
} as const

export type SupportContact = {
  /** Bare MSISDN, e.g. 923001234567 — used to build the wa.me link. */
  whatsapp: string | null
  email: string | null
  /** Free text, e.g. "Mon–Sat, 10am to 8pm PKT". */
  hours: string | null
}

export async function getSupportContact(): Promise<SupportContact> {
  let stored = new Map<string, string | null>()

  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', Object.values(KEYS))
    stored = new Map((data ?? []).map((r) => [r.key as string, (r.value as string) || null]))
  } catch {
    // A support page that cannot reach the database should still render the
    // env-configured contacts. This is the page someone lands on when things
    // are already going wrong.
  }

  const pick = (key: string, env: string | undefined) =>
    (stored.get(key) ?? null) || (env?.trim() || null)

  return {
    // app_settings → env → the one constant, so the number is never missing.
    whatsapp:
      normaliseWhatsapp(pick(KEYS.whatsapp, process.env.SUPPORT_WHATSAPP)) ?? SUPPORT_WHATSAPP_FALLBACK,
    email: pick(KEYS.email, process.env.SUPPORT_EMAIL) ?? SUPPORT_EMAIL_FALLBACK,
    hours: pick(KEYS.hours, process.env.SUPPORT_HOURS),
  }
}

/**
 * The env-only view of the same contacts, with no database read.
 *
 * The Footer renders inside the root layout, on every page in the app.
 * getSupportContact() reaches Supabase through the cookie-backed server client,
 * and a cookies() read in a layout opts EVERY route into dynamic rendering --
 * including /about, /terms and /faq, which have no per-request content and
 * should be generated once at build time. Paying for a database round trip on
 * every page render to put an email address in the footer is the wrong trade.
 *
 * So the footer takes the env values and the /support page -- the screen
 * someone actually opens to get help -- keeps the app_settings-backed version,
 * where an owner's change without a deploy is worth having.
 *
 * Same fallback order minus the first step, so the two can only disagree when
 * app_settings has been edited; the footer then trails until the next deploy.
 */
export function supportContactFromEnv(): SupportContact {
  return {
    whatsapp: normaliseWhatsapp(process.env.SUPPORT_WHATSAPP?.trim() || null) ?? SUPPORT_WHATSAPP_FALLBACK,
    email: (process.env.SUPPORT_EMAIL?.trim() || null) ?? SUPPORT_EMAIL_FALLBACK,
    hours: process.env.SUPPORT_HOURS?.trim() || null,
  }
}
