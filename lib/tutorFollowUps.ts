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
import { pageAllIn } from '@/lib/pageAll'
import { planLabel } from '@/lib/display'
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
  followReason,
  followUpMessage,
  latestContact,
  nextLabel,
  primaryChip,
  tutorDone,
  waitChip,
  type FollowChip,
  type ReasonKind,
  type WaitChip,
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
  /** The one plain reason line (owner, 21 Oct 2026). */
  reason: string
  reasonKind: ReasonKind
  /** Who acts next: the tutor, or us (documents waiting for the Owner). */
  wait: WaitChip
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

/** Each member's newest visit (activity_sessions.last_seen_at). */
async function lastSeenFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin.from('activity_sessions').select('id, user_id, last_seen_at').in('user_id', part).order('id').range(from, to),
  ).catch(() => [])
  for (const r of rows) {
    const id = r.user_id as string
    const at = r.last_seen_at as string | null
    if (at && (!out.has(id) || at > (out.get(id) as string))) out.set(id, at)
  }
  return out
}

/** Every tutor of a scope who has NOT finished, as one follow-up row, newest
 *  first. Finished (lib/tutorFollowUpCore tutorDone) tutors are left out. */
export const loadTutorFollowUps = cache(async (scope: TutorScope = 'recent'): Promise<TutorFollowRow[]> => {
  const now = new Date()
  const rows = await loadUnpaidSignups(now, scope)
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [states, docs, planBody, seen] = await Promise.all([loadFollowUpStates(ids, now), loadTutorDocSummaries(ids), planMessageBody(), lastSeenFor(ids)])
  const nowMs = now.getTime()
  const out: TutorFollowRow[] = []
  for (const r of rows) {
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
      docsWaiting: (d?.waitingCount ?? 0) > 0 && d?.kind === 'waiting',
      waitingSince: d?.oldestUploadAt ?? null,
      joinedAt: r.joinedAt,
      lastSeenAt: seen.get(r.id) ?? null,
    }
    if (tutorDone(facts)) continue
    const chips = chipsFor(facts, nowMs)
    const planMessage = r.startedPayment
      ? fillPaymentNotFinished(planBody, { name: r.name, payLink: payAgainLink(r.startedPayment.planCode) })
      : null
    const msg = followUpMessage(facts, r.name, nowMs, planMessage)
    const reason = followReason(facts, nowMs, r.startedPayment ? planLabel(r.startedPayment.planCode ?? 'verified') : null)
    out.push({
      ...r,
      waHref: r.msisdn ? waLink(r.msisdn, msg.text) : null,
      chips: [...chips],
      primary: primaryChip(chips),
      next: nextLabel(facts),
      contacted: contact ? contactedLine(formatDate(contact.at), contact.by) : null,
      docsLabel: d?.label ?? null,
      reason: reason.text,
      reasonKind: reason.kind,
      wait: waitChip(facts),
      messageType: msg.type,
      templateKey: msg.templateKey,
    })
  }
  return out
})

/** The rows of one chip from the default group — the Overview rows' source. */
export async function tutorsWithChip(chip: FollowChip): Promise<TutorFollowRow[]> {
  return (await loadTutorFollowUps('recent')).filter((r) => r.chips.includes(chip))
}
