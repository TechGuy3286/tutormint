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
import { firstNameOf, waLink, type TutorScope } from '@/lib/staffOutreachCore'
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
  nextPhrase,
} from '@/lib/tutorFollowUpCore'
import {
  asAppDef,
  documentWords,
  FEE_REPLY_PAY_PATH,
  fillFollowUp,
  followReasonFor,
  fuTemplateDef,
  FU_FEE_REPLY_KEY,
  FU_TEMPLATE_KEYS,
  REASON_TEMPLATE,
  reasonSentence,
  type FollowReason,
} from '@/lib/followUpTemplatesCore'

const feeReplyDef = fuTemplateDef(FU_FEE_REPLY_KEY)!
import { resolveBody } from '@/lib/applicationTemplatesCore'
import { fuBadgeCount, progressKey, tabState, type ContactRecord, type TabState } from '@/lib/tutorFollowUpTabsCore'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { siteLink } from '@/lib/waLinkCore'

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
  /** Why they are stuck, the template that reason sends (null = waiting on us,
   *  not a message) and its title (owner, 23 Oct 2026). */
  followReason: FollowReason
  /** "Fee reply": the "About the Verification Fee" message as a WhatsApp
   *  link, or null with no number. */
  feeReplyHref: string | null
  fuTemplateKey: string | null
  fuTemplateTitle: string | null
  /** The progress snapshot stored with the next tap. */
  progress: string
  /** To do / Sent, due date, unanswered count (lib/tutorFollowUpTabsCore). */
  state: TabState
  /** The title of the template last sent, for the Sent line. */
  lastTemplateTitle: string | null
}

/** Every contact with each tutor, newest first: Follow-ups taps (with their
 *  progress snapshot), logged calls and call / WhatsApp notes (no snapshot). */
export async function loadContacts(ids: string[]): Promise<Map<string, ContactRecord[]>> {
  const out = new Map<string, ContactRecord[]>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const push = (id: string, c: ContactRecord) => out.set(id, [...(out.get(id) ?? []), c])
  const [fus, calls, notes] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('member_follow_ups')
        .select('id, member_id, created_at, progress, template_key, staff_name, staff_email')
        .in('member_id', part)
        .is('undone_at', null)
        .order('id')
        .range(from, to),
    ).catch(() => []),
    pageAllIn(ids, (part, from, to) =>
      admin.from('tutor_contact_logs').select('id, tutor_id, created_at, staff_email').in('tutor_id', part).order('id').range(from, to),
    ).catch(() => []),
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('member_notes')
        .select('id, member_id, created_at, kind, staff_name')
        .in('member_id', part)
        .in('kind', ['call', 'whatsapp'])
        .is('withdrawn_at', null)
        .order('id')
        .range(from, to),
    ).catch(() => []),
  ])
  for (const r of fus)
    push(r.member_id as string, {
      at: r.created_at as string,
      progress: (r.progress as string | null) ?? null,
      staffName: staffLabel(r.staff_name as string | null, r.staff_email as string | null),
      templateKey: (r.template_key as string | null) ?? null,
    })
  for (const r of calls) push(r.tutor_id as string, { at: r.created_at as string, progress: null, staffName: staffLabel(null, r.staff_email as string | null) })
  for (const r of notes) push(r.member_id as string, { at: r.created_at as string, progress: null, staffName: staffLabel(r.staff_name as string | null, null) })
  return out
}

/** The Follow-ups templates' stored bodies and titles. */
async function loadFuTemplates(): Promise<Map<string, { body: string; title: string }>> {
  const out = new Map<string, { body: string; title: string }>()
  const admin = createAdminClient()
  if (!admin) return out
  try {
    const { data } = await admin.from('admin_message_templates').select('key, title, body').in('key', [...FU_TEMPLATE_KEYS])
    for (const r of data ?? []) out.set(r.key as string, { body: (r.body as string | null) ?? '', title: (r.title as string | null) ?? '' })
  } catch {
    /* every message falls back to its default */
  }
  return out
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
  const [states, docs, planBody, seen, contacts, fuTemplates, support] = await Promise.all([
    loadFollowUpStates(ids, now),
    loadTutorDocSummaries(ids),
    planMessageBody(),
    lastSeenFor(ids),
    loadContacts(ids),
    loadFuTemplates(),
    loadSupportWhatsApp(),
  ])
  const titleOf = (key: string | null | undefined) => (key ? (fuTemplates.get(key)?.title || fuTemplateDef(key)?.title || null) : null)
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
    // The reason-based template (owner, 23 Oct 2026).
    const why = followReasonFor(facts)
    const key = REASON_TEMPLATE[why]
    const def = key ? fuTemplateDef(key) : null
    const progress = progressKey({ stoppedStep: facts.stoppedStep, completion: facts.completion, feePaid: facts.feePaid, docsApproved: facts.docsApproved })
    const fuText = def
      ? fillFollowUp(
          resolveBody(fuTemplates.get(def.key)?.body, asAppDef(def)),
          {
            firstName: firstNameOf(r.name),
            completion: facts.completion,
            nextStep: nextPhrase(facts),
            continueLink: siteLink('/tutor/dashboard'),
            payLink: payAgainLink(r.startedPayment?.planCode ?? 'verified'),
            document: documentWords(facts.rejected),
            reason: reasonSentence(facts.rejected),
            supportWhatsapp: support,
          },
          why === 'payment' ? 'pay' : 'continue',
        )
      : null
    // "Fee reply" (owner, 23 Oct 2026): the saved "About the Verification Fee"
    // message, on every row with a number. Recorded and counted like any other.
    const feeText = r.msisdn
      ? fillFollowUp(
          resolveBody(fuTemplates.get(FU_FEE_REPLY_KEY)?.body, asAppDef(feeReplyDef)),
          {
            firstName: firstNameOf(r.name),
            completion: facts.completion,
            nextStep: nextPhrase(facts),
            continueLink: siteLink('/tutor/dashboard'),
            payLink: siteLink(FEE_REPLY_PAY_PATH),
            supportWhatsapp: support,
          },
          'pay',
        )
      : null
    const cs = contacts.get(r.id) ?? []
    const state = tabState(
      { joinedAt: r.joinedAt, progress, waitingOnUs: why === 'waiting', contacts: cs, reviewHref: `/admin/users/${r.id}#documents` },
      nowMs,
    )
    out.push({
      ...r,
      // Waiting on us is not a message; the card offers the review instead.
      waHref: r.msisdn && fuText ? waLink(r.msisdn, fuText) : r.msisdn ? waLink(r.msisdn, msg.text) : null,
      feeReplyHref: r.msisdn && feeText ? waLink(r.msisdn, feeText) : null,
      followReason: why,
      fuTemplateKey: def?.key ?? null,
      fuTemplateTitle: titleOf(def?.key),
      progress,
      state,
      lastTemplateTitle: titleOf(state.last?.templateKey),
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

/** The red Follow-ups badge (owner, 23 Oct 2026): overdue To do items across
 *  every group but "Not interested". Tolerant — 0 on any failure. */
export const followUpsOverdueCount = cache(async (): Promise<number> => {
  try {
    return fuBadgeCount((await loadTutorFollowUps('open')).map((r) => r.state))
  } catch {
    return 0
  }
})
