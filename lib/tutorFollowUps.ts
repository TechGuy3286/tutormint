// lib/tutorFollowUps.ts
//
// The I/O half of the merged Follow-ups → Tutors list (owner, 20 Oct 2026).
// ONE loader for the list page AND the Overview rows that open it ("Unpaid
// signups not yet contacted", "Stuck in onboarding", "Started payment, didn't
// finish"), so each Overview number is exactly its chip's count. The rules are
// lib/tutorFollowUpCore. Service role; callers check SCREEN_ACCESS first.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { loadUnpaidSignups, type UnpaidRow } from '@/lib/staffOutreach'
import { loadFollowUpStates } from '@/lib/followUps'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
import { formatDate } from '@/lib/datetime'
import { staffLabel } from '@/lib/followUpCore'
import { waLink, type TutorScope } from '@/lib/staffOutreachCore'
import { fillPaymentNotFinished, payAgainLink, PAYMENT_NOT_FINISHED_FALLBACK, PAYMENT_NOT_FINISHED_KEY } from '@/lib/startedPaymentCore'
import {
  chipsFor,
  contactedLine,
  docFactsFrom,
  followUpMessage,
  latestContact,
  nextLabel,
  primaryChip,
  type FollowChip,
  type MessageType,
  type TutorFollowFacts,
} from '@/lib/tutorFollowUpCore'

export type TutorFollowRow = UnpaidRow & {
  chips: FollowChip[]
  primary: FollowChip
  /** "Next: CNIC photos" — null when nothing is left. */
  next: string | null
  /** "Contacted 18 Oct 2026 by Aqsa", or null. */
  contacted: string | null
  docsLabel: string | null
  /** The prefilled WhatsApp text's type, and the key stored with the follow-up. */
  messageType: MessageType
  templateKey: string
}

async function planMessageBody(): Promise<string> {
  const admin = createAdminClient()
  if (!admin) return PAYMENT_NOT_FINISHED_FALLBACK
  const { data } = await admin.from('admin_message_templates').select('body').eq('key', PAYMENT_NOT_FINISHED_KEY).maybeSingle()
  return ((data?.body as string | undefined) ?? '').trim() || PAYMENT_NOT_FINISHED_FALLBACK
}

/** Every tutor of a scope as one follow-up row, newest first. */
export const loadTutorFollowUps = cache(async (scope: TutorScope = 'recent'): Promise<TutorFollowRow[]> => {
  const now = new Date()
  const rows = await loadUnpaidSignups(now, scope)
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [states, docs, planBody] = await Promise.all([loadFollowUpStates(ids, now), loadTutorDocSummaries(ids), planMessageBody()])
  const nowMs = now.getTime()
  return rows.map((r) => {
    const st = states.get(r.id)
    const contact = latestContact(
      st?.lastAt ? { at: st.lastAt, by: st.lastBy } : null,
      r.lastContact ? { at: r.lastContact.at, by: staffLabel(null, r.lastContact.staffEmail) } : null,
    )
    const d = docs.get(r.id)
    const facts: TutorFollowFacts = {
      feePaid: r.feePaid,
      completion: r.completion,
      stoppedStep: r.stoppedStep,
      ...docFactsFrom(d?.statuses),
      startedPayment: r.startedPayment ? { planCode: r.startedPayment.planCode, startedAt: r.startedPayment.startedAt } : null,
      lastContactAt: contact?.at ?? null,
    }
    const chips = chipsFor(facts, nowMs)
    const planMessage = r.startedPayment
      ? fillPaymentNotFinished(planBody, { name: r.name, payLink: payAgainLink(r.startedPayment.planCode) })
      : null
    const msg = followUpMessage(facts, r.name, nowMs, planMessage)
    return {
      ...r,
      waHref: r.msisdn ? waLink(r.msisdn, msg.text) : null,
      chips: [...chips],
      primary: primaryChip(chips),
      next: nextLabel(facts),
      contacted: contact ? contactedLine(formatDate(contact.at), contact.by) : null,
      docsLabel: d?.label ?? null,
      messageType: msg.type,
      templateKey: msg.templateKey,
    }
  })
})

/** The rows of one chip from the default group — the Overview rows' source. */
export async function tutorsWithChip(chip: FollowChip): Promise<TutorFollowRow[]> {
  return (await loadTutorFollowUps('recent')).filter((r) => r.chips.includes(chip))
}
