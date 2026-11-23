// lib/contactFormCore.ts — PURE (owner, 24 Nov 2026 — PR-20 Part A).
//
// The /contact form: name, mobile or email, message. Each message lands in the
// Team inbox (Contact form) and is emailed to support. Spam protection is a
// honeypot field (a hidden "website" box a person never fills — a filled one is
// answered "sent" and dropped) plus a per-IP rate limit (`contact_form` bucket).
// Nothing from the form is ever logged: the inbox row is the only copy, and its
// mobile / email is shown masked with a logged Show.

import { normalisePkMobile, formatPkMobile } from '@/lib/phone'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'

export const CONTACT_NAME_MAX = 80
export const CONTACT_MESSAGE_MIN = 10
export const CONTACT_MESSAGE_MAX = 2000
/** The honeypot field's name — hidden from people, irresistible to scripts. */
export const HONEYPOT_FIELD = 'website'

export const CONTACT_SENT = 'Thank you. Your message has reached the TutorMint team. We reply on WhatsApp or email, usually within a working day.'
export const CONTACT_TOO_MANY = 'You have sent several messages already. Please wait an hour, or message us on WhatsApp.'
export const CONTACT_FAILED = 'Your message could not be sent just now. Please message us on WhatsApp or email instead.'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export type ContactInput = { name?: unknown; contact?: unknown; message?: unknown; website?: unknown }

export type ContactParsed =
  | { ok: true; spam: true }
  | { ok: true; spam: false; name: string; contact: string; kind: 'mobile' | 'email'; message: string }
  | { ok: false; error: string }

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Check the form. A filled honeypot is spam (answered "sent", never stored). */
export function parseContact(input: ContactInput): ContactParsed {
  if (String(input.website ?? '').trim() !== '') return { ok: true, spam: true }
  const name = clean(input.name, CONTACT_NAME_MAX)
  if (name.length < 2) return { ok: false, error: 'Please write your name.' }
  const rawContact = clean(input.contact, 120)
  const message = String(input.message ?? '').replace(/\r\n/g, '\n').trim().slice(0, CONTACT_MESSAGE_MAX)
  if (message.length < CONTACT_MESSAGE_MIN) return { ok: false, error: 'Please write a little more in your message.' }
  const mobile = normalisePkMobile(rawContact)
  if (mobile) return { ok: true, spam: false, name, contact: mobile, kind: 'mobile', message }
  if (EMAIL_RE.test(rawContact)) return { ok: true, spam: false, name, contact: rawContact.toLowerCase(), kind: 'email', message }
  return { ok: false, error: 'Please write a Pakistani mobile number (03XX XXXXXXX) or an email address so we can reply.' }
}

/** The contact as the inbox list shows it: "0321 •••• 222" / "a•••@gmail.com". */
export function maskContact(contact: string, kind: 'mobile' | 'email'): string {
  if (kind === 'mobile') return maskPhoneDisplay(contact) ?? '••••'
  const [user, domain] = contact.split('@')
  if (!domain) return '•••'
  return `${(user ?? '').slice(0, 1)}•••@${domain}`
}

/** The contact in full (after a logged Show): "0321 5872222" or the email. */
export function showContact(contact: string, kind: 'mobile' | 'email'): string {
  return kind === 'mobile' ? formatPkMobile(contact) : contact
}

/** The email to support: the message itself, to the support mailbox only.
 *  The subject carries nothing personal (email_sends records it). */
export function contactEmail(m: { name: string; contact: string; kind: 'mobile' | 'email'; message: string; inboxUrl: string }): { subject: string; text: string } {
  return {
    subject: 'New message from the TutorMint contact form',
    text: [
      'A new message came in through tutormint.org/contact.',
      '',
      `Name: ${m.name}`,
      `${m.kind === 'mobile' ? 'Mobile' : 'Email'}: ${showContact(m.contact, m.kind)}`,
      '',
      m.message,
      '',
      `Open it in the Team inbox: ${m.inboxUrl}`,
    ].join('\n'),
  }
}

/** Which button the page suggests, by who is asking. */
export const CONTACT_WHO: { who: string; line: string }[] = [
  { who: 'Tutors', line: 'Questions about your profile, documents or the Verification Fee: WhatsApp is fastest.' },
  { who: 'Parents', line: 'Help posting a tuition or finding a tutor: WhatsApp us, or use the form below.' },
  { who: 'Academies and schools', line: 'Hiring teachers or listing several posts: email us, or use the form below.' },
]
