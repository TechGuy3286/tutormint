// lib/adminWhatsApp.ts
//
// The I/O half of lib/adminWhatsAppCore: reads ONE member's state (role, name,
// number, profile %, onboarding step, documents, a started checkout) and
// returns the pre-filled wa.me link. Service role; the caller checks access.
// Never logs the number.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { flowStateByTutor } from '@/lib/onboardingStop'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
import { itemState } from '@/lib/tutorDocSummaryCore'
import { loadStartedNotFinished } from '@/lib/startedPayment'
import { formatName } from '@/lib/formatName'
import { docFactsFrom, type TutorFollowFacts } from '@/lib/tutorFollowUpCore'
import { fillPaymentNotFinished, payAgainLink, PAYMENT_NOT_FINISHED_FALLBACK, PAYMENT_NOT_FINISHED_KEY } from '@/lib/startedPaymentCore'
import { adminMemberMessage, adminWaLink, type AdminMessageType } from '@/lib/adminWhatsAppCore'

export type AdminWhatsApp = { href: string; type: AdminMessageType } | { href: null; type: null }

export async function adminWhatsAppFor(memberId: string, now = new Date(), refCode: string | null = null): Promise<AdminWhatsApp> {
  const admin = createAdminClient()
  if (!admin) return { href: null, type: null }
  const [{ data: p }, { data: tp }] = await Promise.all([
    admin.from('profiles').select('id, role, full_name, whatsapp, phone_number, profile_completion').eq('id', memberId).maybeSingle(),
    admin.from('tutor_profiles').select('id, whatsapp_number, verified_fee_paid_at').eq('id', memberId).maybeSingle(),
  ])
  if (!p) return { href: null, type: null }
  const number =
    (p.whatsapp as string | null) || (tp?.whatsapp_number as string | null) || (p.phone_number as string | null) || null
  const name = formatName(p.full_name as string | null) || ''
  // A parent never gets a message from here: only their situation message
  // (lib/parentWhatsApp) — owner, 31 Oct 2026.
  if (p.role === 'parent' || p.role === 'academy') return { href: null, type: null }
  const role = p.role === 'tutor' ? 'tutor' : 'other'

  let tutor = null
  if (role === 'tutor') {
    const [flow, docs, started] = await Promise.all([
      flowStateByTutor(admin, [memberId]),
      loadTutorDocSummaries([memberId]),
      loadStartedNotFinished(now),
    ])
    const statuses = docs.get(memberId)?.statuses
    const mine = started.find((s) => s.userId === memberId) ?? null
    const facts: TutorFollowFacts = {
      feePaid: !!tp?.verified_fee_paid_at,
      completion: Number(p.profile_completion ?? 0),
      stoppedStep: flow.get(memberId)?.stoppedStep ?? null,
      ...docFactsFrom(statuses),
      startedPayment: mine ? { planCode: mine.planCode, startedAt: mine.createdAt } : null,
      lastContactAt: null,
    }
    let planMessage: string | null = null
    if (mine && mine.planCode && mine.planCode !== 'verified') {
      const { data } = await admin.from('admin_message_templates').select('body').eq('key', PAYMENT_NOT_FINISHED_KEY).maybeSingle()
      const body = ((data?.body as string | undefined) ?? '').trim() || PAYMENT_NOT_FINISHED_FALLBACK
      planMessage = fillPaymentNotFinished(body, { name, payLink: payAgainLink(mine.planCode) })
    }
    const docsWaiting = !!statuses && [statuses.cnic, statuses.profilePic, statuses.selfie].some((s) => itemState(s) === 'waiting')
    tutor = { facts, docsWaiting, planMessage }
  }

  const msg = adminMemberMessage({ role, name, tutor, nowMs: now.getTime() })
  const href = adminWaLink(number, msg.text, refCode)
  return href ? { href, type: msg.type } : { href: null, type: null }
}
