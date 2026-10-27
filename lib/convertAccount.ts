// lib/convertAccount.ts
//
// The I/O half of Convert account type (owner, 23 Oct 2026; rules in
// lib/convertAccountCore). The route checks Owner-only and the fresh password
// first. Nothing is deleted and no payment is touched: the role changes, a
// tutor profile is created (Parent → Tutor) or hidden (Tutor → Parent), and the
// change is audited ('member.convert_role', which the Activity tab shows).
//
// The person is told in-app and by email (when their email is confirmed).
// NOT by SMS: SendPK sends only the approved verification-code template — any
// other text is refused, or would arrive reading "Your TutorMint verification
// code is …". So the SMS step is left out on purpose and logged as such.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import { formatDate } from '@/lib/datetime'
import { formatName } from '@/lib/formatName'
import { paymentPlanName } from '@/lib/paymentLabelCore'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import type { AdminActor } from '@/lib/adminAuth'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'
import {
  convertBlockers,
  convertClashMessage,
  convertDecision,
  convertNotice,
  convertTarget,
  findConvertClash,
  mergeInsteadHref,
  plainDbError,
  type AccountRole,
  type ClashCandidate,
  type ConvertClash,
  type ConvertFacts,
} from '@/lib/convertAccountCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
const NOT_WORKING = 'This is not working right now. Please try again in a few minutes.'

async function factsFor(admin: Admin, memberId: string, p: Record<string, unknown>): Promise<ConvertFacts> {
  const { data: pays } = await admin
    .from('payments')
    .select('plan_code, reviewed_at, created_at')
    .eq('user_id', memberId)
    .eq('status', 'approved')
    .is('refunded_at', null)
    .order('reviewed_at', { ascending: true })
  const approvedDocs: string[] = []
  if (p.cnic_verified_at || p.verification_state === 'approved') approvedDocs.push('CNIC')
  if (p.profile_pic_status === 'approved') approvedDocs.push('Profile photo')
  if (p.selfie_status === 'approved') approvedDocs.push('Selfie')
  if (p.address_verified_at || p.address_status === 'approved') approvedDocs.push('Home address')
  return {
    paid: (pays ?? []).map((x) => ({ plan: paymentPlanName(x.plan_code as string | null), date: formatDate((x.reviewed_at as string) || (x.created_at as string)) })),
    approvedDocs,
  }
}

const PROFILE_COLS =
  'id, role, full_name, email, city, phone_number, cnic_number, linked_account_id, cnic_verified_at, verification_state, profile_pic_status, selfie_status, address_verified_at, address_status, admin_role'

export type ConvertPreview = { role: AccountRole; to: AccountRole; name: string; blockers: string[]; clash: (ConvertClash & { mergeHref: string; message: string }) | null }

/** Another account of the target type with this person's mobile, CNIC or link. */
async function clashFor(admin: Admin, p: Record<string, unknown>, to: AccountRole): Promise<ConvertClash | null> {
  const ors: string[] = []
  const digits = String(p.phone_number ?? '').replace(/\D/g, '')
  if (digits.length >= 10) ors.push(`phone_number.like.%${digits.slice(-10)}`)
  const cnic = String(p.cnic_number ?? '').replace(/\D/g, '')
  if (cnic.length === 13) ors.push(`cnic_number.eq.${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`, `cnic_number.eq.${cnic}`)
  if (p.linked_account_id) ors.push(`id.eq.${p.linked_account_id}`)
  ors.push(`linked_account_id.eq.${p.id}`)
  const { data } = await admin.from('profiles').select('id, role, full_name, phone_number, cnic_number, linked_account_id').eq('role', to).neq('id', p.id as string).or(ors.join(',')).limit(10)
  const candidates: ClashCandidate[] = (data ?? []).map((r) => ({
    id: r.id as string,
    name: formatName(r.full_name as string | null),
    role: r.role as string,
    phone: (r.phone_number as string | null) ?? null,
    cnic: (r.cnic_number as string | null) ?? null,
    linkedAccountId: (r.linked_account_id as string | null) ?? null,
  }))
  return findConvertClash(
    { id: p.id as string, phone: (p.phone_number as string | null) ?? null, cnic: (p.cnic_number as string | null) ?? null, linkedAccountId: (p.linked_account_id as string | null) ?? null },
    to,
    candidates,
    maskPhoneDisplay,
  )
}

function clashView(memberId: string, c: ConvertClash, to: AccountRole) {
  return { ...c, mergeHref: mergeInsteadHref(memberId, c.id), message: convertClashMessage(c, to) }
}

/** What the confirmation shows: who, to what, and what blocks it (in words). */
export async function convertPreview(memberId: string): Promise<ConvertPreview | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: p } = await admin.from('profiles').select(PROFILE_COLS).eq('id', memberId).maybeSingle()
  const to = convertTarget(p?.role as string | null)
  if (!p || !to) return null
  const clash = await clashFor(admin, p, to)
  return {
    role: p.role as AccountRole,
    to,
    name: formatName(p.full_name as string | null) || 'Member',
    blockers: convertBlockers(await factsFor(admin, memberId, p)),
    clash: clash ? clashView(memberId, clash, to) : null,
  }
}

export type ConvertResult =
  | { ok: true; to: AccountRole; emailed: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500 | 503; error: string; needsOverride?: boolean; blockers?: string[]; clash?: ReturnType<typeof clashView> }

/** A write the database refused: the reason in words (digits removed) on the
 *  screen and in the log — never a phone, CNIC or email. A clash on the
 *  one-account-per-mobile index is named as such. */
function failed(step: string, e: { code?: string | null; message?: string | null }): ConvertResult {
  const reason = plainDbError(e)
  console.error(`[convert-account] ${step} refused: ${reason}`)
  if (e.code === '23505' && /mobile|phone/i.test(String(e.message))) {
    return { ok: false, status: 409, error: 'This mobile already has an account of that type. Find it in People and merge this account into it instead.' }
  }
  return { ok: false, status: 500, error: `That did not save — the database refused it (${reason}). Nothing was changed.` }
}

export async function convertAccount(args: { actor: AdminActor; memberId: string; reason: string; override: boolean }): Promise<ConvertResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const { data: p } = await admin.from('profiles').select(PROFILE_COLS).eq('id', args.memberId).maybeSingle()
  if (!p) return { ok: false, status: 404, error: 'That member was not found.' }
  if (p.admin_role) return { ok: false, status: 400, error: 'A staff account cannot be changed here.' }
  const facts = await factsFor(admin, args.memberId, p)
  const decision = convertDecision({ role: p.role as string, reason: args.reason, facts, override: args.override })
  if (!decision.ok) return { ok: false, status: decision.needsOverride ? 409 : 400, error: decision.message, ...(decision.needsOverride ? { needsOverride: true, blockers: decision.blockers } : {}) }
  const from = p.role as AccountRole
  const to = convertTarget(from) as AccountRole

  // One tutor and one parent account per mobile (migrations 154, 156): an
  // account of the target type with this person's mobile, CNIC or link means
  // they already have one — offer a merge instead (hotfix, 27 Oct 2026).
  const clash = await clashFor(admin, p, to)
  if (clash) {
    const view = clashView(args.memberId, clash, to)
    return { ok: false, status: 409, error: view.message, clash: view }
  }

  const now = new Date().toISOString()
  const { error: roleErr } = await admin
    .from('profiles')
    .update({ role: to, account_type: to === 'parent' ? 'parent' : null })
    .eq('id', args.memberId)
    .eq('role', from)
  if (roleErr) return failed('role', roleErr)

  const { data: tp } = await admin.from('tutor_profiles').select('id, city').eq('id', args.memberId).maybeSingle()
  if (to === 'tutor') {
    // The same account and login; a tutor profile draft with the name and city
    // (or the one they had before, shown again).
    const { error } = tp
      ? await admin
          .from('tutor_profiles')
          .update({ converted_to_parent_at: null, converted_to_parent_by: null, ...(tp.city ? {} : p.city ? { city: p.city } : {}) })
          .eq('id', args.memberId)
      : await admin.from('tutor_profiles').insert({
          id: args.memberId,
          full_name: formatName(p.full_name as string | null) || 'Tutor',
          // NOT NULL on tutor_profiles (ensureProfile writes it too). Leaving it
          // out made every Parent → Tutor change fail (hotfix, 27 Oct 2026).
          email: (p.email as string | null) ?? '',
          city: (p.city as string | null) ?? null,
          verification_status: 'pending',
        })
    if (error) {
      // Put the role back so the account is never left half-changed.
      await admin.from('profiles').update({ role: from, account_type: from === 'parent' ? 'parent' : null }).eq('id', args.memberId)
      return failed('tutor_profile', error)
    }
  } else if (tp) {
    // Hidden, not deleted: out of search and the sitemap; its address 301s.
    await admin.from('tutor_profiles').update({ converted_to_parent_at: now, converted_to_parent_by: args.actor.id }).eq('id', args.memberId)
  }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'member.convert_role',
    targetType: 'profile',
    targetId: args.memberId,
    // The reason and the blocker WORDS — never a number or an amount.
    detail: { from, to, reason: args.reason.trim(), override: args.override, blockers: convertBlockers(facts), sms: 'not sent: SendPK sends the verification-code template only' },
  })
  try {
    revalidateLanding()
  } catch {
    /* the cached directory catches up on its own */
  }

  const notice = convertNotice(to)
  await notify({ userId: args.memberId, kind: 'account_type_changed', title: notice.title, body: notice.body, href: notice.href }).catch(() => {})
  let emailed = false
  try {
    const r = await deliverEmail(
      { userId: args.memberId },
      { id: 'account_type_changed', name: (p.full_name as string | null) ?? '', to, supportWhatsapp: await loadSupportWhatsApp(admin) },
    )
    emailed = !!r.ok
  } catch {
    /* told in-app either way */
  }
  return { ok: true, to, emailed }
}
