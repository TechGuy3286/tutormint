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
    whatsapp: normaliseWhatsapp(pick(KEYS.whatsapp, process.env.SUPPORT_WHATSAPP)),
    email: pick(KEYS.email, process.env.SUPPORT_EMAIL),
    hours: pick(KEYS.hours, process.env.SUPPORT_HOURS),
  }
}

/** Strip everything a person might type around a number: +, spaces, dashes. */
function normaliseWhatsapp(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^\d]/g, '')
  return digits.length >= 10 ? digits : null
}

/** A wa.me link with the message pre-filled, or null when unconfigured. */
export function whatsappHref(msisdn: string | null, prefill?: string): string | null {
  if (!msisdn) return null
  const q = prefill ? `?text=${encodeURIComponent(prefill)}` : ''
  return `https://wa.me/${msisdn}${q}`
}
