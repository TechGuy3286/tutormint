// lib/applicationMessagesCore.ts
//
// PURE, client-safe. Every WhatsApp message Admin → Tuitions → Applications
// pre-fills (owner, 22 Oct 2026, Applications v3). ONE FILE so the wording is
// easy to edit later: change a line here and every button, the preview and the
// tests follow.
//
// Rules for every message:
//   - plain English, no Urdu added;
//   - the TM number and the tuition title;
//   - a link only to a TutorMint page, on its own line;
//   - ends with the support WhatsApp line;
//   - never a price, a fee amount or a superlative (tested);
//   - never a phone number or an email address — the recipient's number goes
//     only into the wa.me link, built on the server.

import { siteLink } from '@/lib/waLinkCore'
import { TUTOR_STAGE_TEXT, type Stage } from '@/lib/applicationStageCore'

/** The support line every message ends with. */
export const SUPPORT_LINE = 'Need help? WhatsApp us on 0321 5872222.'

export type Recipient = 'parent' | 'tutor'

/** Who the row's WhatsApp button writes to, by stage. */
export const STAGE_RECIPIENT: Record<Stage, Recipient> = {
  applied: 'parent',
  forwarded: 'parent',
  contacted: 'parent',
  demo: 'parent',
  hired: 'tutor',
  not_selected: 'tutor',
  no_response: 'tutor',
}

/** The message's key — stored on the follow-up record (never its text). */
export type MessageKey = 'share_profile' | 'ask_contacted' | 'ask_demo' | 'ask_demo_result' | 'hired_story' | 'not_selected' | 'no_response' | 'forward' | 'tutor_update'

export const STAGE_MESSAGE: Record<Stage, MessageKey> = {
  applied: 'share_profile',
  forwarded: 'ask_contacted',
  contacted: 'ask_demo',
  demo: 'ask_demo_result',
  hired: 'hired_story',
  not_selected: 'not_selected',
  no_response: 'no_response',
}

/** Short names for the Sent line: "<message> sent to Parent by Aqsa". */
export const MESSAGE_LABEL: Record<MessageKey, string> = {
  share_profile: 'Profile shared',
  ask_contacted: 'Contact check',
  ask_demo: 'Demo offer',
  ask_demo_result: 'Demo check',
  hired_story: 'Congratulations',
  not_selected: 'Kind update',
  no_response: 'Kind update',
  forward: 'Tutors forwarded',
  tutor_update: 'Tutor update',
}

export const RECIPIENT_LABEL: Record<Recipient, string> = { parent: 'Parent', tutor: 'Tutor' }

/** The button's words, and what it says when that person has no number. */
export function buttonLabel(recipient: Recipient, hasNumber: boolean): string {
  if (!hasNumber) return recipient === 'parent' ? 'No parent number' : 'No tutor number'
  return recipient === 'parent' ? 'WhatsApp parent' : 'WhatsApp tutor'
}

export type StageMessageInput = {
  stage: Stage
  ref: string | null
  title: string
  parentName: string | null
  tutorName: string | null
  /** The tutor's public profile path (/tutor/<slug>), when they have one. */
  tutorProfilePath: string | null
  /** The tutor's city — for the "open tuitions" link. */
  tutorCity: string | null
}

function firstName(name: string | null | undefined, fallback: string): string {
  const f = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return f || fallback
}

const PHONE_LIKE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
/** Names and titles typed by people can never carry a number or address in. */
export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(PHONE_LIKE, '').replace(EMAIL_LIKE, '').replace(/\s{2,}/g, ' ').trim()
}

/** "TM-1303 — Online Tutor Required". */
export function tuitionLabel(ref: string | null, title: string): string {
  const t = clean(title) || 'your tuition'
  return ref ? `${ref} — ${t}` : t
}

/** Open tuitions in a city (the tutor's own, else every city). */
export function openTuitionsPath(city: string | null | undefined): string {
  const c = (city ?? '').trim()
  return c ? `/browse/tuitions?city=${encodeURIComponent(c)}` : '/browse/tuitions'
}

function compose(lines: (string | null)[]): string {
  return [...lines.filter((l): l is string => l !== null), '', SUPPORT_LINE].join('\n')
}

/** The pre-filled message for a row's WhatsApp button, by stage. */
export function stageMessage(i: StageMessageInput): string {
  const tuition = tuitionLabel(i.ref, i.title)
  const tutor = clean(i.tutorName) || 'the tutor'
  const parentHi = `Assalam o Alaikum ${clean(firstName(i.parentName, ''))}`.trim()
  const tutorHi = `Assalam o Alaikum ${clean(firstName(i.tutorName, ''))}`.trim()
  const profile = i.tutorProfilePath ? siteLink(i.tutorProfilePath) : null
  switch (i.stage) {
    case 'applied':
      return compose([
        `${parentHi}, this is TutorMint about your tuition ${tuition}.`,
        `${tutor} has applied.${profile ? ' You can see their TutorMint profile here:' : ''}`,
        profile,
        'Reply here if you would like to talk to them.',
      ])
    case 'forwarded':
      return compose([
        `${parentHi}, this is TutorMint about your tuition ${tuition}.`,
        `We shared ${tutor}'s profile with you. Did you get a chance to contact them?`,
      ])
    case 'contacted':
      return compose([
        `${parentHi}, this is TutorMint about your tuition ${tuition}.`,
        `Would you like to arrange a demo lesson or an interview with ${tutor}? We can help set it up.`,
      ])
    case 'demo':
      return compose([
        `${parentHi}, this is TutorMint about your tuition ${tuition}.`,
        `How did the demo or interview with ${tutor} go? Would you like to go ahead with them?`,
      ])
    case 'hired':
      return compose([
        `${tutorHi}, congratulations on getting the tuition ${tuition}!`,
        'Could you send us a short line about your experience with TutorMint? We would love to share it as a success story.',
      ])
    case 'not_selected':
      return compose([
        `${tutorHi}, thank you for applying to ${tuition}.`,
        'The parent chose another tutor this time. New tuitions are posted every day — here are the open ones in your city:',
        siteLink(openTuitionsPath(i.tutorCity)),
      ])
    case 'no_response':
      return compose([
        `${tutorHi}, thank you for applying to ${tuition}.`,
        'The parent has not replied to us. New tuitions are posted every day — here are the open ones in your city:',
        siteLink(openTuitionsPath(i.tutorCity)),
      ])
  }
}

export type TutorUpdateItem = { ref: string | null; title: string; stage: Stage }

/** Active = still moving (Applied → Demo/interview). */
export const ACTIVE_STAGES: readonly Stage[] = ['applied', 'forwarded', 'contacted', 'demo']

/** The By-tutor message: every active application, in the dashboard's words. */
export function tutorUpdateMessage(tutorName: string | null, items: TutorUpdateItem[]): string {
  const hi = `Assalam o Alaikum ${clean(firstName(tutorName, ''))}`.trim()
  const lines = items.map((i) => `• ${tuitionLabel(i.ref, i.title)}: ${TUTOR_STAGE_TEXT[i.stage]}`)
  return compose([
    `${hi}, here is an update on your TutorMint applications:`,
    ...lines,
    '',
    'You can see them all on your dashboard:',
    siteLink('/tutor/dashboard'),
  ])
}

// The forward panel's parent message is the admin-editable "Applicants to
// forward" template (Team inbox → Templates; lib/applicantForwardCore).

/** For the tests: words no message may contain. */
export const FORBIDDEN_WORDS = /\b(rs\.?|pkr|rupees?|price|fee|best|top|largest|biggest|cheapest|no\.?\s?1|number one|#1|leading|guaranteed?)\b/i
