// lib/contactMaskCore.ts — PURE, client-safe.
//
// The member page header shows a masked phone and (only when the member has a
// real one) a masked email, each with a "Show" button that is written to Audit
// (owner, 26 Oct 2026). The auto-made <msisdn>@users.tutormint.org address is
// never shown at all.

import { isSyntheticEmail, normalisePkMobile } from '@/lib/phone'

/** "923481234733" / "0348-1234733" → "0348 •••• 733". */
export function maskPhoneDisplay(raw: string | null | undefined): string | null {
  const msisdn = normalisePkMobile(raw ?? null)
  if (!msisdn) {
    const digits = (raw ?? '').replace(/\D/g, '')
    if (digits.length < 7) return null
    return `${digits.slice(0, 4)} •••• ${digits.slice(-3)}`
  }
  const local = `0${msisdn.slice(2)}`
  return `${local.slice(0, 4)} •••• ${local.slice(-3)}`
}

/** "ayesha.khan@gmail.com" → "ay•••@gmail.com"; a synthetic address → null. */
export function maskEmailDisplay(email: string | null | undefined): string | null {
  const e = (email ?? '').trim()
  if (!e || !e.includes('@') || isSyntheticEmail(e)) return null
  const [local, domain] = [e.slice(0, e.lastIndexOf('@')), e.slice(e.lastIndexOf('@') + 1)]
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}•••@${domain}`
}

/** A real email the member gave (never the auto-made one). */
export function realEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim()
  return e && e.includes('@') && !isSyntheticEmail(e) ? e : null
}

export type RevealField = 'phone' | 'email' | 'whatsapp'
