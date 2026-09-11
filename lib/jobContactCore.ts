// lib/jobContactCore.ts
//
// The pure normalisation + validation of an admin-posted tuition's contact block
// (owner, 11 Sep 2026). No I/O, so the round-trip and the "only what was filled"
// rule are unit-testable without a database. createTeamJob (server) validates
// with buildJobContact before writing job_contacts; loadJobContact reads the row
// back into the same shape; the job page renders only the present fields.
//
// Admin-posted tuitions are copied from public hiring ads — school and academy
// Facebook posts, WhatsApp statuses — so the poster's details are the
// institution's, openly published contact, not a private household's. They live
// ONLY in job_contacts (never on the anon-readable jobs row), are shown to
// signed-in tutors only, and never touch metadata, JSON-LD, OG or the sitemap.

import { normalisePkMobile, looksLikeEmail } from '@/lib/phone'

/** The six optional fields as typed on the admin form. */
export type JobContactInput = {
  name?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  address?: string | null
  social?: string | null
}

/** The stored shape — job_contacts columns. Every field independently nullable. */
export type JobContactRecord = {
  contact_name: string | null
  contact_phone: string | null // MSISDN
  contact_whatsapp: string | null // MSISDN
  contact_email: string | null
  contact_address: string | null
  contact_social: string | null
}

export type BuildResult =
  | { ok: true; record: JobContactRecord; hasContact: boolean }
  | { ok: false; field: 'phone' | 'whatsapp' | 'email'; error: string }

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

/**
 * Normalise and validate the contact block. Phone and WhatsApp go through the
 * one canonical MSISDN normaliser (so tel:/wa.me links are clean); email is
 * shape-checked; address and social are free text (no invented format). An
 * invalid phone/WhatsApp/email is rejected with a field-named message rather
 * than silently dropped — the admin typed it, so they should fix it. Empty
 * fields become null: only what was filled is stored.
 */
export function buildJobContact(input: JobContactInput): BuildResult {
  const name = clean(input.name)
  const address = clean(input.address)
  const social = clean(input.social)

  let phone: string | null = null
  const rawPhone = clean(input.phone)
  if (rawPhone) {
    phone = normalisePkMobile(rawPhone)
    if (!phone) {
      return {
        ok: false,
        field: 'phone',
        error: 'Enter a valid Pakistani mobile number for the parent contact, or leave it blank.',
      }
    }
  }

  let whatsapp: string | null = null
  const rawWa = clean(input.whatsapp)
  if (rawWa) {
    whatsapp = normalisePkMobile(rawWa)
    if (!whatsapp) {
      return {
        ok: false,
        field: 'whatsapp',
        error: 'Enter a valid Pakistani WhatsApp number for the parent contact, or leave it blank.',
      }
    }
  }

  let email: string | null = null
  const rawEmail = clean(input.email)
  if (rawEmail) {
    if (!looksLikeEmail(rawEmail)) {
      return {
        ok: false,
        field: 'email',
        error: 'Enter a valid email for the parent contact, or leave it blank.',
      }
    }
    email = rawEmail.toLowerCase()
  }

  const record: JobContactRecord = {
    contact_name: name,
    contact_phone: phone,
    contact_whatsapp: whatsapp,
    contact_email: email,
    contact_address: address,
    contact_social: social,
  }
  const hasContact = !!(name || phone || whatsapp || email || address || social)
  return { ok: true, record, hasContact }
}

/** Read a stored row back into the normalised record, trimming blanks to null. */
export function normaliseStoredContact(row: Partial<JobContactRecord> | null): JobContactRecord | null {
  if (!row) return null
  const record: JobContactRecord = {
    contact_name: clean(row.contact_name),
    contact_phone: clean(row.contact_phone),
    contact_whatsapp: clean(row.contact_whatsapp),
    contact_email: clean(row.contact_email),
    contact_address: clean(row.contact_address),
    contact_social: clean(row.contact_social),
  }
  const hasAny = Object.values(record).some((v) => v !== null)
  return hasAny ? record : null
}
