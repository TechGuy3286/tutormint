// lib/applicationTemplatesCore.ts
//
// PURE, client-safe. Applications v3.1 (owner, 23 Oct 2026): every message
// Admin → Tuitions → Applications pre-fills is an editable template in Team
// inbox → Templates, in the "Applications" group. This file holds the
// built-in defaults (exactly the v3 wording), the placeholders each template
// may use, the fill rules, and the save checks.
//
//   - A stored template that is missing, empty or carries an unknown
//     placeholder is never sent: the built-in default is used instead, so a
//     message never goes out blank or with "{oops}" in it.
//   - Saving with an unknown placeholder is BLOCKED; a price or a superlative
//     is a WARNING only.
//   - {support_whatsapp} is read from settings (app_settings
//     'support.whatsapp'), so changing the number needs no deploy.

import type { Stage } from '@/lib/applicationStageCore'

export type TemplateRecipient = 'parent' | 'tutor'

export type AppTemplateKey =
  | 'app_applied'
  | 'app_forwarded'
  | 'app_contacted'
  | 'app_demo'
  | 'app_hired'
  | 'app_not_selected'
  | 'app_no_response'
  | 'app_tutor_update'

/** What each placeholder means — shown beside the editor. */
export const PLACEHOLDER_HELP: Record<string, string> = {
  parent_name: "The parent's first name",
  tutor_name: "The tutor's full name",
  tutor_first_name: "The tutor's first name",
  tm_number: 'The tuition number, e.g. TM-1303',
  tuition_title: "The tuition's title",
  city: "The tuition's city (By tutor: the tutor's city)",
  profile_link: "The tutor's public profile link",
  open_tuitions_link: "Open tuitions in the tutor's city",
  dashboard_link: "The tutor's dashboard link",
  applications_list: "One line per application in progress, with its stage",
  support_whatsapp: 'Our support WhatsApp number (from settings)',
  area: "The tuition's area",
  tutor_list: 'One line per tutor: name and profile link',
}

const STAGE_PLACEHOLDERS = [
  'parent_name',
  'tutor_name',
  'tutor_first_name',
  'tm_number',
  'tuition_title',
  'city',
  'profile_link',
  'open_tuitions_link',
  'dashboard_link',
  'support_whatsapp',
] as const

const TUTOR_UPDATE_PLACEHOLDERS = [
  'tutor_name',
  'tutor_first_name',
  'city',
  'applications_list',
  'open_tuitions_link',
  'dashboard_link',
  'support_whatsapp',
] as const

const SUPPORT = '\n\nNeed help? WhatsApp us on {support_whatsapp}.'
const PARENT_HI = 'Assalam o Alaikum {parent_name}, this is TutorMint about your tuition {tm_number} — {tuition_title}.'

/** The built-in defaults: byte-for-byte the v3 wording (tested). */
export const APP_TEMPLATE_DEFAULTS: Record<AppTemplateKey, string> = {
  app_applied:
    `${PARENT_HI}\n{tutor_name} has applied. You can see their TutorMint profile here:\n{profile_link}\nReply here if you would like to talk to them.` +
    SUPPORT,
  app_forwarded: `${PARENT_HI}\nWe shared {tutor_name}'s profile with you. Did you get a chance to contact them?` + SUPPORT,
  app_contacted:
    `${PARENT_HI}\nWould you like to arrange a demo lesson or an interview with {tutor_name}? We can help set it up.` + SUPPORT,
  app_demo: `${PARENT_HI}\nHow did the demo or interview with {tutor_name} go? Would you like to go ahead with them?` + SUPPORT,
  app_hired:
    'Assalam o Alaikum {tutor_first_name}, congratulations on getting the tuition {tm_number} — {tuition_title}!\nCould you send us a short line about your experience with TutorMint? We would love to share it as a success story.' +
    SUPPORT,
  app_not_selected:
    'Assalam o Alaikum {tutor_first_name}, thank you for applying to {tm_number} — {tuition_title}.\nThe parent chose another tutor this time. New tuitions are posted every day — here are the open ones in your city:\n{open_tuitions_link}' +
    SUPPORT,
  app_no_response:
    'Assalam o Alaikum {tutor_first_name}, thank you for applying to {tm_number} — {tuition_title}.\nThe parent has not replied to us. New tuitions are posted every day — here are the open ones in your city:\n{open_tuitions_link}' +
    SUPPORT,
  app_tutor_update:
    'Assalam o Alaikum {tutor_first_name}, here is an update on your TutorMint applications:\n{applications_list}\n\nYou can see them all on your dashboard:\n{dashboard_link}' +
    SUPPORT,
}

export type AppTemplateDef = {
  key: AppTemplateKey
  title: string
  recipient: TemplateRecipient
  /** The stage whose row button sends it; null = the By-tutor message. */
  stage: Stage | null
  placeholders: readonly string[]
  defaultBody: string
}

/** The Applications group, in the order the stages run. */
export const APP_TEMPLATES: readonly AppTemplateDef[] = [
  { key: 'app_applied', title: 'Applications — Applied (share the profile)', recipient: 'parent', stage: 'applied', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_applied },
  { key: 'app_forwarded', title: 'Applications — Forwarded (did you contact them?)', recipient: 'parent', stage: 'forwarded', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_forwarded },
  { key: 'app_contacted', title: 'Applications — Contacted (demo or interview?)', recipient: 'parent', stage: 'contacted', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_contacted },
  { key: 'app_demo', title: 'Applications — Demo/interview (how did it go?)', recipient: 'parent', stage: 'demo', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_demo },
  { key: 'app_hired', title: 'Applications — Hired (congratulations)', recipient: 'tutor', stage: 'hired', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_hired },
  { key: 'app_not_selected', title: 'Applications — Not selected (kind update)', recipient: 'tutor', stage: 'not_selected', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_not_selected },
  { key: 'app_no_response', title: 'Applications — No response (kind update)', recipient: 'tutor', stage: 'no_response', placeholders: STAGE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_no_response },
  { key: 'app_tutor_update', title: 'Applications — By tutor (check-in)', recipient: 'tutor', stage: null, placeholders: TUTOR_UPDATE_PLACEHOLDERS, defaultBody: APP_TEMPLATE_DEFAULTS.app_tutor_update },
]

export const APP_TEMPLATE_KEYS: readonly AppTemplateKey[] = APP_TEMPLATES.map((t) => t.key)

/** The template a stage's row button sends. */
export const STAGE_TEMPLATE: Record<Stage, AppTemplateKey> = {
  applied: 'app_applied',
  forwarded: 'app_forwarded',
  contacted: 'app_contacted',
  demo: 'app_demo',
  hired: 'app_hired',
  not_selected: 'app_not_selected',
  no_response: 'app_no_response',
}

export function isAppTemplateKey(key: string): key is AppTemplateKey {
  return (APP_TEMPLATE_KEYS as readonly string[]).includes(key)
}

export function appTemplateDef(key: string): AppTemplateDef | null {
  return APP_TEMPLATES.find((t) => t.key === key) ?? null
}

const TOKEN = /\{([a-z_]+)\}/g

/** Placeholders in a body that the template does not know (in order, once each). */
export function unknownPlaceholders(body: string, allowed: readonly string[]): string[] {
  const out: string[] = []
  for (const m of body.matchAll(TOKEN)) if (!allowed.includes(m[1]) && !out.includes(m[1])) out.push(m[1])
  return out
}

/** The block message for a save with unknown placeholders. */
export function unknownPlaceholderError(unknown: string[]): string {
  const list = unknown.map((u) => `{${u}}`).join(', ')
  return `${unknown.length === 1 ? 'This placeholder is' : 'These placeholders are'} not known: ${list}. Use only the placeholders listed beside the editor.`
}

const PRICE = /\b(rs\.?|pkr|rupees?)(?=[\s\d.,:]|$)|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\s*(?:\/-|k\b)/i
const SUPERLATIVE = /\b(largest|biggest|best|top|no\.?\s?1|number one|#1)\b|#1/i

/** Warnings (never a block) for a template body. Placeholders are ignored. */
export function templateWarnings(body: string): string[] {
  const text = body.replace(TOKEN, ' ')
  const out: string[] = []
  if (PRICE.test(text)) out.push('This message mentions a price or an amount. Messages should not show prices.')
  if (SUPERLATIVE.test(text)) out.push('This message uses a word like "best", "top", "largest" or "No.1". Please avoid claims like these.')
  return out
}

/** The body to send: the stored one when it is usable, else the default. */
export function resolveBody(stored: string | null | undefined, def: AppTemplateDef): string {
  const body = (stored ?? '').trim()
  if (!body) return def.defaultBody
  if (unknownPlaceholders(body, def.placeholders).length) return def.defaultBody
  return stored as string
}

/**
 * Fill a template. An empty value is removed cleanly:
 *   - a line made only of placeholders, all empty, is dropped;
 *   - "{tm_number} — " goes with an empty number, and " {parent_name}" takes
 *     its space with it ("Assalam o Alaikum, this is…").
 * Unknown placeholders are removed (resolveBody keeps them from being sent).
 */
export function fillTemplate(body: string, values: Record<string, string | null | undefined>): string {
  const val = (k: string) => (values[k] ?? '').trim()
  const lines = body.split('\n').filter((line) => {
    const tokens = [...line.matchAll(TOKEN)].map((m) => m[1])
    if (tokens.length === 0) return true
    const rest = line.replace(TOKEN, '').trim()
    return !(rest === '' && tokens.every((k) => !val(k)))
  })
  let text = lines.join('\n')
  for (const m of [...new Set([...text.matchAll(TOKEN)].map((x) => x[1]))]) {
    if (val(m)) continue
    text = text.split(`{${m}} — `).join('').split(` {${m}}`).join('')
  }
  return text.replace(TOKEN, (_all, k: string) => val(k))
}

/** Sample data for the editor's live preview (no real person). */
export const SAMPLE_VALUES: Record<string, string> = {
  parent_name: 'Sana',
  tutor_name: 'Rida Saeed',
  tutor_first_name: 'Rida',
  tm_number: 'TM-1303',
  tuition_title: 'Home Tutor Required | Grade 5 | DHA | Lahore',
  city: 'Lahore',
  profile_link: 'https://www.tutormint.org/tutor/rida-saeed-tutor',
  open_tuitions_link: 'https://www.tutormint.org/browse/tuitions?city=Lahore',
  dashboard_link: 'https://www.tutormint.org/tutor/dashboard',
  applications_list: '• TM-1303 — Home Tutor Required: Shared with the parent\n• TM-1288 — Online Tutor Required: Sent to the parent team',
  area: 'DHA',
  tutor_list: 'Rida Saeed: https://www.tutormint.org/tutor/rida-saeed-tutor',
}
