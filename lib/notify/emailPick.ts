// lib/notify/emailPick.ts
//
// PURE. Which wording an email goes out in (owner, 28 Oct 2026): the APPROVED
// simple-English wording when email_wordings has one for it, the built-in
// email of lib/notify/templates.ts otherwise. So an email is unchanged until
// the Owner approves its new wording. Read by lib/notify/emailWording.ts and
// unit-tested in scripts/test-template-rewrite.ts.

import { TUITION_LIVE_LABEL } from '@/lib/tuitionStatus'
import { emailKey, emailWordingFor } from '@/lib/notify/emailWordingCore'
import { proposalFor } from '@/lib/templateProposals'
import { render, renderWording, type RenderedEmail, type TemplateInput } from '@/lib/notify/templates'

export type StoredWording = { subject: string; body: string }

export function pickEmail(input: TemplateInput, approved: ReadonlyMap<string, StoredWording>, support: string): RenderedEmail {
  const builtIn = render(input)
  const fill = emailWordingFor(input, TUITION_LIVE_LABEL)
  if (!fill) return builtIn
  const stored = approved.get(fill.variant)
  if (!stored) return builtIn
  const button = proposalFor(emailKey(fill.variant))?.button ?? null
  const unsubscribe = input.id === 'tuition_match' ? input.unsubscribeHref : undefined
  return renderWording({ ...stored, button }, { ...fill.values, support_whatsapp: support }, fill.href, builtIn.essential, unsubscribe)
}
