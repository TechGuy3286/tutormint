import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { getSupportContact } from '@/lib/support'
import { formatPkMobile } from '@/lib/phone'
import { planSwitchedEmails, SWITCHED_EMAIL_KEY, type SkipReason, type SwitchedTutorFacts } from '@/lib/switchedTutorEmailCore'

// The one-time "You can now sign in to TutorMint" email (owner, 13 Oct 2026).
// The rules are pure (lib/switchedTutorEmailCore); this loads the facts and
// sends. Run from scripts/send-switched-tutor-email.ts through the
// CRON_SECRET-protected /api/internal/switched-tutor-email route, because the
// Resend key lives only in the production environment.

const ACTOR = 'system: switched tutor email (13 Oct 2026)'

export type SwitchedEmailResult = {
  dryRun: boolean
  candidates: number
  wouldSend: number
  sent: number
  failed: number
  skipped: Record<SkipReason, number>
}

async function loadFacts(): Promise<(SwitchedTutorFacts & { id: string; name: string })[]> {
  const admin = createAdminClient()
  if (!admin) throw new Error('service-role client unavailable')
  // The accounts switched on 13 Oct 2026 — each has one Audit row from that run.
  const { data: audit, error } = await admin.from('admin_audit_log').select('target_id').eq('action', 'member.email_unblock').limit(1000)
  if (error) throw new Error(error.message)
  const ids = [...new Set((audit ?? []).map((r) => r.target_id as string).filter(Boolean))]
  if (ids.length === 0) return []
  const [{ data: profiles }, { data: tutors }, { data: sent }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, role, admin_role, full_name, email, phone_verified_at, is_suspended, is_banned, paused_by_user_at, is_seed, is_test_name')
      .in('id', ids),
    admin.from('tutor_profiles').select('id, hidden_from_public').in('id', ids),
    admin.from('one_off_emails').select('user_id').eq('email_key', SWITCHED_EMAIL_KEY).in('user_id', ids),
  ])
  const hidden = new Set((tutors ?? []).filter((t) => t.hidden_from_public).map((t) => t.id as string))
  const already = new Set((sent ?? []).map((r) => r.user_id as string))
  return (profiles ?? []).map((p) => ({
    id: p.id as string,
    name: ((p.full_name as string | null) ?? '').trim(),
    switched: true,
    role: (p.role as string | null) ?? null,
    adminRole: (p.admin_role as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    mobileVerified: !!p.phone_verified_at,
    suspended: !!p.is_suspended,
    banned: !!p.is_banned,
    selfPaused: !!p.paused_by_user_at,
    isSeed: !!p.is_seed,
    isTestName: !!p.is_test_name,
    hiddenFromPublic: hidden.has(p.id as string),
    alreadySent: already.has(p.id as string),
  }))
}

/**
 * Send (or, with dryRun, only count) the one-time email. Never returns an
 * address. A dry run writes nothing and sends nothing.
 */
export async function sendSwitchedTutorEmails(opts: { dryRun: boolean }): Promise<SwitchedEmailResult> {
  const rows = await loadFacts()
  const plan = planSwitchedEmails(rows)
  const result: SwitchedEmailResult = { dryRun: opts.dryRun, candidates: rows.length, wouldSend: plan.send.length, sent: 0, failed: 0, skipped: plan.skipped }
  if (opts.dryRun) return result

  const admin = createAdminClient()
  if (!admin) throw new Error('service-role client unavailable')
  const support = await getSupportContact()
  const supportWhatsapp = (support.whatsapp && formatPkMobile(support.whatsapp)) || '0321 5872222'
  const byId = new Map(rows.map((r) => [r.id, r]))

  for (const id of plan.send) {
    // The record FIRST: unique (user_id, email_key) refuses a second row, so two
    // runs at once — or a run repeated later — cannot both send.
    const { error: claim } = await admin.from('one_off_emails').insert({ user_id: id, email_key: SWITCHED_EMAIL_KEY })
    if (claim) {
      result.skipped.already_sent += 1
      continue
    }
    const res = await deliverEmail({ userId: id }, { id: 'switched_tutor_signin', name: byId.get(id)?.name ?? '', supportWhatsapp })
    if (!res.ok) {
      // Not accepted for sending: take the record back so a later run can try.
      await admin.from('one_off_emails').delete().eq('user_id', id).eq('email_key', SWITCHED_EMAIL_KEY)
      result.failed += 1
      continue
    }
    result.sent += 1
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_email: ACTOR,
      actor_role: 'system',
      action: 'member.one_off_email',
      target_type: 'member',
      target_id: id,
      detail: { email: 'You can now sign in to TutorMint', key: SWITCHED_EMAIL_KEY },
    })
  }
  return result
}
