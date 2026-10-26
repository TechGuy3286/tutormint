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
//   every template       a price or a superlative is a WARNING, never a block —
//                        except the price warning on a template that states the
//                        price on purpose ("About the Verification Fee").
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
import { FU_PLACEHOLDERS, FU_TEMPLATES } from '@/lib/followUpTemplatesCore'
import { PARENT_DEFAULTS, PARENT_PLACEHOLDERS, PARENT_TEMPLATES } from '@/lib/parentFollowUpCore'
import { STATUS_IMAGE_DEFAULT, STATUS_IMAGE_TEMPLATE_KEY, STATUS_PLACEHOLDERS, statusSaveProblem } from '@/lib/social/statusImageCore'

export type GroupTemplateInfo = {
  key: string
  recipient: TemplateRecipient
  placeholders: readonly string[]
  defaultBody: string
  /** States a price on purpose: the price warning is not shown. */
  priceExpected?: boolean
  /** Must never carry a link (the status image message, owner 26 Oct 2026). */
  noLinks?: boolean
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

/** The Follow-ups group (owner, 23 Oct 2026): one message per reason a tutor
 *  is stuck — four new templates and four reused stored ones. */
export const FOLLOW_UPS_GROUP: readonly GroupTemplateInfo[] = FU_TEMPLATES.map((t) => ({
  key: t.key,
  recipient: 'tutor' as const,
  placeholders: FU_PLACEHOLDERS,
  defaultBody: t.defaultBody,
  priceExpected: t.priceExpected === true,
}))

/** Follow-ups → Parents (owner, 26 Oct 2026): one message per situation. */
export const PARENTS_GROUP: readonly GroupTemplateInfo[] = PARENT_TEMPLATES.map((t) => ({
  key: t.key,
  recipient: 'parent' as const,
  placeholders: PARENT_PLACEHOLDERS,
  defaultBody: PARENT_DEFAULTS[t.key],
}))

/** The "Send status image" message (owner, 26 Oct 2026): link placeholders are
 *  blocked (only {tutor_first_name} is known) and no address may be typed in. */
export const STATUS_GROUP: readonly GroupTemplateInfo[] = [
  { key: STATUS_IMAGE_TEMPLATE_KEY, recipient: 'tutor', placeholders: STATUS_PLACEHOLDERS, defaultBody: STATUS_IMAGE_DEFAULT, noLinks: true },
]

export function groupTemplateInfo(key: string): GroupTemplateInfo | null {
  return (
    APPLICATIONS_GROUP.find((t) => t.key === key) ??
    FOLLOW_UPS_GROUP.find((t) => t.key === key) ??
    PARENTS_GROUP.find((t) => t.key === key) ??
    STATUS_GROUP.find((t) => t.key === key) ??
    null
  )
}

/** The built-in default, or null for a template that has none. */
export function templateDefault(key: string): string | null {
  return groupTemplateInfo(key)?.defaultBody ?? null
}

/** The warnings for a body — without the price warning for a template that
 *  states its price on purpose. */
export function warningsFor(key: string, body: string): string[] {
  const all = templateWarnings(body)
  return groupTemplateInfo(key)?.priceExpected ? all.filter((w) => !PRICE_WARNING_START.test(w)) : all
}
const PRICE_WARNING_START = /^This message mentions a price/

export type SaveCheck = { ok: true; warnings: string[] } | { ok: false; error: string; unknown: string[] }

export function templateSaveCheck(key: string, body: string): SaveCheck {
  const info = groupTemplateInfo(key)
  if (info) {
    if (!body.trim()) return { ok: false, error: 'Write the message, or use Reset to default.', unknown: [] }
    const unknown = unknownPlaceholders(body, info.placeholders)
    if (unknown.length) return { ok: false, error: unknownPlaceholderError(unknown), unknown }
    if (info.noLinks) {
      const problem = statusSaveProblem(body)
      if (problem) return { ok: false, error: problem, unknown: [] }
    }
  }
  return { ok: true, warnings: warningsFor(key, body) }
}

export { appTemplateDef }
