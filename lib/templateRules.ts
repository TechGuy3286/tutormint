// lib/templateRules.ts
//
// PURE, client-safe. What Team inbox → Templates checks when a template is
// saved (owner, 23 Oct 2026, Applications v3.1).
//
//   Applications group   the 8 Applications templates + the forward panel's
//                        "Applicants to forward" message. Each has a fixed list
//                        of placeholders (unknown → BLOCKED) and a built-in
//                        default ("Reset to default", and the fallback when
//                        a stored body is empty).
//   every template       a price or a superlative is a WARNING, never a block.
//
// Other templates keep their own placeholders ({name}, {job_title}, …) and are
// not placeholder-checked: they were written before this rule.

import {
  APP_TEMPLATES,
  appTemplateDef,
  templateWarnings,
  unknownPlaceholderError,
  unknownPlaceholders,
  type TemplateRecipient,
} from '@/lib/applicationTemplatesCore'
import { APPLICANTS_FORWARD_DEFAULT, APPLICANTS_FORWARD_TEMPLATE_KEY } from '@/lib/applicantForwardCore'

export type GroupTemplateInfo = {
  key: string
  recipient: TemplateRecipient
  placeholders: readonly string[]
  defaultBody: string
}

/** The forward panel's message, shown in the Applications group too. */
export const FORWARD_TEMPLATE_INFO: GroupTemplateInfo = {
  key: APPLICANTS_FORWARD_TEMPLATE_KEY,
  recipient: 'parent',
  placeholders: ['parent_name', 'tuition_title', 'area', 'tutor_list'],
  defaultBody: APPLICANTS_FORWARD_DEFAULT,
}

/** The Applications group, in order: the stages, By tutor, then the forward message. */
export const APPLICATIONS_GROUP: readonly GroupTemplateInfo[] = [
  ...APP_TEMPLATES.map((t) => ({ key: t.key, recipient: t.recipient, placeholders: t.placeholders, defaultBody: t.defaultBody })),
  FORWARD_TEMPLATE_INFO,
]

export function groupTemplateInfo(key: string): GroupTemplateInfo | null {
  return APPLICATIONS_GROUP.find((t) => t.key === key) ?? null
}

/** The built-in default, or null for a template that has none. */
export function templateDefault(key: string): string | null {
  return groupTemplateInfo(key)?.defaultBody ?? null
}

export type SaveCheck = { ok: true; warnings: string[] } | { ok: false; error: string; unknown: string[] }

export function templateSaveCheck(key: string, body: string): SaveCheck {
  const info = groupTemplateInfo(key)
  if (info) {
    if (!body.trim()) return { ok: false, error: 'Write the message, or use Reset to default.', unknown: [] }
    const unknown = unknownPlaceholders(body, info.placeholders)
    if (unknown.length) return { ok: false, error: unknownPlaceholderError(unknown), unknown }
  }
  return { ok: true, warnings: templateWarnings(body) }
}

export { appTemplateDef }
