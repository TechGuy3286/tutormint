// lib/paidWelcome.ts
//
// "Send welcome" for a paid tutor (owner, 9 Nov 2026) — the I/O half. Rules in
// lib/paidWelcomeCore. Service role; the route checks SCREEN_ACCESS first.
// Never logs a phone, email or CNIC number.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { normalisePkMobile } from '@/lib/phone'
import { formatDate } from '@/lib/datetime'
import { planLabel } from '@/lib/display'
import { siteLink, waSendHref } from '@/lib/waLinkCore'
import { senderRefCode } from '@/lib/staffSignups'
import { firstNameOf } from '@/lib/staffOutreachCore'
import { currentWelcome, welcomeMessage, WELCOME_SOURCE, type Welcome } from '@/lib/paidWelcomeCore'

const LIST = 'people:tutor'

/** Each tutor's standing welcome (undone ones left out). */
export async function loadWelcomes(ids: string[]): Promise<Map<string, Welcome>> {
  const out = new Map<string, Welcome>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin
      .from('member_follow_ups')
      .select('id, member_id, created_at, undone_at, staff_name')
      .in('member_id', part)
      .eq('source', WELCOME_SOURCE)
      .order('id')
      .range(from, to),
  ).catch(() => [])
  const by = new Map<string, { id: string; created_at: string; undone_at: string | null; staff_name: string | null }[]>()
  for (const r of rows) {
    const k = r.member_id as string
    by.set(k, [...(by.get(k) ?? []), { id: r.id as string, created_at: r.created_at as string, undone_at: (r.undone_at as string | null) ?? null, staff_name: (r.staff_name as string | null) ?? null }])
  }
  for (const [k, list] of by) {
    const w = currentWelcome(list)
    if (w) out.set(k, w)
  }
  return out
}

export type WelcomeBuild =
  | { ok: true; waHref: string }
  | { ok: false; status: number; error: string }

/** The WhatsApp address with the welcome in it, for one paid tutor. */
export async function buildWelcome(memberId: string, staffId: string): Promise<WelcomeBuild> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const nowIso = new Date().toISOString()
  const [{ data: p }, { data: tp }, { data: listed }, { data: subs }, support, ref] = await Promise.all([
    admin.from('profiles').select('full_name, role, whatsapp, phone_number').eq('id', memberId).maybeSingle(),
    admin.from('tutor_profiles').select('slug, verified_fee_paid_at').eq('id', memberId).maybeSingle(),
    admin.from('tutor_directory').select('id').eq('id', memberId).maybeSingle(),
    admin
      .from('subscriptions')
      .select('plan_code, expires_at')
      .eq('user_id', memberId)
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .order('expires_at', { ascending: false })
      .limit(1),
    loadSupportWhatsApp(admin),
    senderRefCode(staffId),
  ])
  if (!p || p.role !== 'tutor') return { ok: false, status: 404, error: 'That tutor was not found.' }
  if (!tp?.verified_fee_paid_at) return { ok: false, status: 409, error: 'This tutor has not paid the Verification Fee yet.' }
  const msisdn = normalisePkMobile(((p.whatsapp as string | null) ?? (p.phone_number as string | null)) ?? null)
  if (!msisdn) return { ok: false, status: 400, error: 'This tutor has no WhatsApp number.' }
  const sub = (subs ?? [])[0]
  const planName = sub ? planLabel(sub.plan_code as string) : null
  const text = welcomeMessage({
    firstName: firstNameOf((p.full_name as string | null) ?? ''),
    profileUrl: listed && tp.slug ? siteLink(`/tutor/${tp.slug as string}`) : null,
    plan: sub && planName && sub.expires_at ? { name: planName, endsOn: formatDate(sub.expires_at as string) } : null,
    supportWhatsapp: support,
  })
  return { ok: true, waHref: waSendHref(msisdn, text, ref) }
}

/** Puts the tutor's current welcome on their stored People row at once (the
 *  summary job would only catch up within a few minutes). Never throws. */
export async function refreshWelcomeOnRow(memberId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    const { data } = await admin.from('admin_list_rows').select('row').eq('list', LIST).eq('member_id', memberId).maybeSingle()
    const row = (data?.row ?? null) as { pipe?: Record<string, unknown> } | null
    if (!row?.pipe) return
    const welcome = (await loadWelcomes([memberId])).get(memberId) ?? null
    await admin.from('admin_list_rows').update({ row: { ...row, pipe: { ...row.pipe, welcome } } }).eq('list', LIST).eq('member_id', memberId)
  } catch {
    /* the next summary run puts it right */
  }
}
