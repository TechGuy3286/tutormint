// lib/tutorPipeline.ts
//
// The I/O half of the tutor pipeline on People (owner, 8 Nov 2026; rules in
// lib/tutorPipelineCore and lib/tutorPipelineCardCore). ONE loader for the
// People → Tutors list (via the admin summary job), the People badge and the
// Overview to-do rows, so every number is the length of what its view shows.
// Service role; callers check SCREEN_ACCESS first. Never logs a phone, email
// or CNIC number.

import type { NiMark } from '@/lib/notInterestedCore'
import { eraseDateLine, eraseMovesCount, eraseTags } from '@/lib/eraseRequestedCore'
import { pickUpgrade, type UpgradeHeld } from '@/lib/upgradePlanCore'
import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { runMemo } from '@/lib/runMemo'
import { loadDirectory, loadDirectoryDocs, inTab } from '@/lib/peopleDirectory'
import { loadNotInterested } from '@/lib/followUpDismissals'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { blankPhotoFlags } from '@/lib/photoBlank'
import { staffLabel } from '@/lib/followUpCore'
import { loadWelcomes } from '@/lib/paidWelcome'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
import { callLogAttempt, kindOfTemplateKey, legacyDocsApproved, stageOfProgress, type PipeContact } from '@/lib/tutorPipelineCore'
import { pipeCardFrom, withContacts, type PipeCard } from '@/lib/tutorPipelineCardCore'
import { triedToPay } from '@/lib/paymentAttemptsCore'
import type { PaymentFacts } from '@/lib/paymentLabelCore'
import { applyBadgeDelta, applyOverviewDelta, badgeDelta, mergeLiveCard, peopleRowFor, type StoredPeopleRow } from '@/lib/pipelineRowUpdateCore'
import type { BadgesPayload } from '@/lib/adminSummaryCore'

export { pipeCardFrom, pipeDocsOf, pipeSortAt, pipeTags, followUpDue, feePendingDue, readyForReviewFrom, type PipeCard } from '@/lib/tutorPipelineCardCore'

const LIST = 'people:tutor'

/** Every contact with each tutor: Follow-ups records, logged calls, and call /
 *  WhatsApp notes. Undone and withdrawn ones are left out; parent follow-ups too. */
export async function loadPipeContacts(ids: string[]): Promise<Map<string, PipeContact[]>> {
  const out = new Map<string, PipeContact[]>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const push = (id: string, c: PipeContact) => out.set(id, [...(out.get(id) ?? []), c])
  const [fus, calls, notes] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('member_follow_ups')
        .select('id, member_id, created_at, channel, template_key, progress, source, staff_name, staff_email')
        .in('member_id', part)
        .is('undone_at', null)
        .order('id')
        .range(from, to),
    ).catch(() => []),
    pageAllIn(ids, (part, from, to) =>
      admin.from('tutor_contact_logs').select('id, tutor_id, created_at, outcome, staff_email').in('tutor_id', part).order('id').range(from, to),
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
  for (const r of fus) {
    // A paid tutor's welcome (owner, 9 Nov 2026) is not a pipeline follow-up.
    if (r.source === 'parents' || r.source === 'welcome') continue
    const progress = (r.progress as string | null) ?? null
    const kind = kindOfTemplateKey(r.template_key as string | null) ?? (r.channel === 'call' ? 'call' : r.channel === 'email' ? 'inbox' : 'whatsapp')
    push(r.member_id as string, {
      at: r.created_at as string,
      kind,
      stage: stageOfProgress(progress),
      docsApproved: legacyDocsApproved(progress),
      staffName: staffLabel(r.staff_name as string | null, r.staff_email as string | null),
    })
  }
  for (const r of calls)
    // A call that did not reach them is an attempt, never a follow-up (owner, 15 Nov 2026).
    push(r.tutor_id as string, {
      at: r.created_at as string,
      kind: 'call',
      stage: null,
      docsApproved: null,
      staffName: staffLabel(null, r.staff_email as string | null),
      attempt: callLogAttempt(r.outcome as string | null, r.created_at as string | null),
    })
  for (const r of notes)
    push(r.member_id as string, {
      at: r.created_at as string,
      kind: r.kind === 'call' ? 'call' : 'whatsapp',
      stage: null,
      docsApproved: null,
      staffName: staffLabel(r.staff_name as string | null, null),
    })
  return out
}

/** Each paid tutor's live Premium / Featured upgrade (owner, 10 Nov 2026). */
async function upgradesFor(ids: string[], nowMs: number): Promise<Map<string, UpgradeHeld>> {
  const out = new Map<string, UpgradeHeld>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin
      .from('subscriptions')
      .select('id, user_id, plan_code, status, expires_at')
      .in('user_id', part)
      .eq('status', 'active')
      .in('plan_code', ['premium', 'featured'])
      .order('id')
      .range(from, to),
  ).catch(() => [])
  const by = new Map<string, { plan_code: string | null; status: string | null; expires_at: string | null }[]>()
  for (const r of rows) {
    const k = r.user_id as string
    by.set(k, [...(by.get(k) ?? []), { plan_code: r.plan_code as string, status: r.status as string, expires_at: r.expires_at as string | null }])
  }
  for (const [k, subs] of by) {
    const held = pickUpgrade(subs, nowMs)
    if (held) out.set(k, held)
  }
  return out
}

/** The tutors who started a Verification Fee payment that never completed and
 *  have not paid since (owner, 15 Nov 2026 — lib/paymentAttemptsCore). */
export async function triedToPayFor(ids: string[], nowMs: number): Promise<Set<string>> {
  const out = new Set<string>()
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return out
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin
      .from('payments')
      .select('id, user_id, plan_code, amount_pkr, status, provider, created_at, screenshot_path, reference, refunded_amount_pkr, refunded_at, checkout_closed_at, checkout_close_reason')
      .in('user_id', part)
      .eq('plan_code', 'verified')
      .order('id')
      .range(from, to),
  ).catch(() => [])
  const by = new Map<string, PaymentFacts[]>()
  for (const r of rows) {
    const k = r.user_id as string
    by.set(k, [
      ...(by.get(k) ?? []),
      {
        planCode: (r.plan_code as string | null) ?? null,
        amountPkr: (r.amount_pkr as number | null) ?? null,
        status: String(r.status ?? ''),
        provider: (r.provider as string | null) ?? null,
        createdAt: String(r.created_at ?? ''),
        hasReceipt: !!r.screenshot_path || !!String(r.reference ?? '').trim(),
        refundedAmountPkr: (r.refunded_amount_pkr as number | null) ?? null,
        refundedAt: (r.refunded_at as string | null) ?? null,
        checkoutClosedAt: (r.checkout_closed_at as string | null) ?? null,
        checkoutCloseReason: (r.checkout_close_reason as string | null) ?? null,
      },
    ])
  }
  for (const [k, ps] of by) if (triedToPay(ps, nowMs)) out.add(k)
  return out
}

/** Each member's newest visit. */
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

/** Every tutor (every account in the Tutors tab, hidden and deleted included)
 *  with its pipeline card. Once per summary run. */
export const loadTutorPipeline = cache(
  (): Promise<Map<string, PipeCard>> =>
    runMemo('tutor-pipeline', async () => {
      const now = Date.now()
      const [dir, docs, ni, support, blank] = await Promise.all([loadDirectory(), loadDirectoryDocs(), loadNotInterested(), loadSupportWhatsApp(), blankPhotoFlags(null)])
      const tutors = inTab(dir.people, 'tutor', true)
      const ids = tutors.map((t) => t.id)
      const paidIds = tutors.filter((t) => !!t.feePaidAt).map((t) => t.id)
      const unpaidIds = tutors.filter((t) => !t.feePaidAt).map((t) => t.id)
      const [contacts, seen, welcomes, upgrades, tried] = await Promise.all([loadPipeContacts(ids), lastSeenFor(ids), loadWelcomes(ids), upgradesFor(paidIds, now), triedToPayFor(unpaidIds, now)])
      const out = new Map<string, PipeCard>()
      for (const t of tutors)
        out.set(
          t.id,
          pipeCardFrom({
            name: t.name,
            feePaid: !!t.feePaidAt,
            completion: t.completion,
            mobileOk: t.mobileOk,
            blank: blank.get(t.id) ?? [],
            docs: docs.get(t.id),
            contacts: contacts.get(t.id) ?? [],
            notInterested: ni.has(t.id),
            niMark: (() => {
              const m = ni.get(t.id)
              return m ? { reason: m.reason, note: m.note, by: m.by, at: m.at } : null
            })(),
            paused: t.suspended || t.banned || t.selfPaused,
            lastActiveAt: seen.get(t.id) ?? t.createdAt,
            support,
            nowMs: now,
            paidAt: t.feePaidAt,
            welcome: welcomes.get(t.id) ?? null,
            plan: upgrades.get(t.id) ?? null,
            triedToPay: tried.has(t.id),
          }),
        )
      return out
    }),
)

/**
 * ONE tutor's pipeline card, live (owner, 15 Nov 2026) — the admin member page
 * shows the stage's own contact buttons from it, so a contact made there is
 * logged exactly as on the card. null for anyone who is not a tutor.
 */
export async function loadOnePipeCard(memberId: string): Promise<PipeCard | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const nowMs = Date.now()
  const [{ data: p }, { data: tp }, docs, contacts, ni, support, tried] = await Promise.all([
    admin.from('profiles').select('role, full_name, profile_completion, phone_number, phone_verified_at, created_at, is_suspended, is_banned, paused_by_user_at').eq('id', memberId).maybeSingle(),
    admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', memberId).maybeSingle(),
    loadTutorDocSummaries([memberId]),
    loadPipeContacts([memberId]),
    admin.from('follow_up_dismissals').select('id').eq('member_id', memberId).is('undone_at', null).limit(1),
    loadSupportWhatsApp(),
    triedToPayFor([memberId], nowMs),
  ])
  if (p?.role !== 'tutor') return null
  return pipeCardFrom({
    name: (p.full_name as string | null) ?? '',
    feePaid: !!tp?.verified_fee_paid_at,
    completion: Number(p.profile_completion ?? 0) || 0,
    mobileOk: !!p.phone_number && !!p.phone_verified_at,
    docs: docs.get(memberId),
    contacts: contacts.get(memberId) ?? [],
    notInterested: (ni.data ?? []).length > 0,
    paused: !!p.is_suspended || !!p.is_banned || !!p.paused_by_user_at,
    lastActiveAt: (p.created_at as string | null) ?? null,
    support,
    nowMs,
    triedToPay: tried.has(memberId),
    paidAt: (tp?.verified_fee_paid_at as string | null) ?? null,
  })
}

/** How a stored People card is recomputed after a change. */
export type PipelineRowChange =
  /** A follow-up, call outcome or its Undo: only the contacts changed. */
  | { kind: 'contacts' }
  /** A document decision (or its Undo): the stage may have moved — the card is built live. */
  | { kind: 'live' }
  /** "Not interested" or its Undo. */
  | { kind: 'ni'; ni: boolean; mark: NiMark | null }

export type PipelineRowUpdate = { prev: PipeCard; next: PipeCard; at: number }

/**
 * The card moves at once (owner, 15 Nov 2026): after a follow-up, call
 * outcome, "Not interested", Undo or document decision, that ONE tutor's stored
 * People row is rewritten in the same request, and the stored badge numbers
 * are nudged by the difference (lib/pipelineRowUpdateCore). The chip counts
 * are counted live in SQL from the row tags, so they are right straight away;
 * the summary job's rebuild stays the safety net. Returns the card before and
 * after (the page moves the card out of its chip with it). Never throws.
 */
export async function updatePipelineRow(memberId: string, change: PipelineRowChange): Promise<PipelineRowUpdate | null> {
  const admin = createAdminClient()
  if (!admin) return null
  try {
    const { data } = await admin.from('admin_list_rows').select('tags, row').eq('list', LIST).eq('member_id', memberId).maybeSingle()
    const stored = data ? ({ tags: (data.tags ?? {}) as Record<string, unknown>, row: (data.row ?? {}) as StoredPeopleRow['row'] } satisfies StoredPeopleRow) : null
    const prev = stored?.row.pipe
    if (!stored || !prev) return null
    const real = stored.tags.excluded === false
    const now = Date.now()
    let next: PipeCard
    if (change.kind === 'contacts' && prev.enteredAt !== undefined) {
      next = withContacts(prev, (await loadPipeContacts([memberId])).get(memberId) ?? [], now)
    } else if (change.kind === 'ni') {
      next = { ...prev, notInterested: change.ni, niMark: change.ni ? change.mark : null }
    } else {
      const live = await loadOnePipeCard(memberId)
      if (!live) return null
      next = mergeLiveCard(prev, live)
    }
    // One clock for the stored tags, the badge/Overview nudge and (via `at`)
    // the page's chip shift (PR-10).
    const write = peopleRowFor(stored, next, now)
    const { error } = await admin.from('admin_list_rows').update(write).eq('list', LIST).eq('member_id', memberId)
    if (error) return null
    await nudgeBadges(badgeDelta(prev, next, now, real))
    return { prev, next, at: now }
  } catch {
    return null /* the next summary run puts it right */
  }
}

/** The stored sidebar badges AND the stored Overview to-do rows, moved by one
 *  card's change (PR-02), so the badge, the Overview and the chips agree at
 *  once. Best effort — the next summary run recomputes them. */
async function nudgeBadges(delta: ReturnType<typeof badgeDelta>): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data } = await admin.from('admin_summary').select('key, payload').in('key', ['badges', 'overview:7', 'overview:30'])
  for (const r of data ?? []) {
    const cur = r.payload as Record<string, unknown> | null
    if (!cur) continue
    const next = r.key === 'badges' ? applyBadgeDelta(cur as unknown as BadgesPayload, delta) : applyOverviewDelta(cur as Record<string, { count: number } | undefined>, delta)
    if (next) await admin.from('admin_summary').update({ payload: next }).eq('key', r.key)
  }
}

/** After a follow-up is recorded or undone. The card is rebuilt live (PR-02),
 *  so a stored card from before the numbering fix is put right too. Never throws. */
export async function refreshPipelineRow(memberId: string): Promise<PipelineRowUpdate | null> {
  return updatePipelineRow(memberId, { kind: 'live' })
}

/**
 * Any logged change to a member (owner, 16 Nov 2026 — PR-02): a re-upload, a
 * payment, a document decision, a completion change, a welcome… The People
 * card of a tutor used to move only for the follow-up, Not interested and
 * document-review routes; every other change waited for the summary rebuild,
 * so some views lagged. lib/activityLog and lib/auditLog call this after the
 * response is sent (next/server after()): the stored card is rebuilt live and
 * the badge and Overview figures nudged. A no-op for anyone without a stored
 * tutor row. Never throws.
 */
export async function syncPipelineRowAfterChange(memberId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data } = await admin.from('admin_list_rows').select('member_id').eq('list', LIST).eq('member_id', memberId).maybeSingle()
    if (!data) return
    await updatePipelineRow(memberId, { kind: 'live' })
  } catch {
    /* the next summary run puts it right */
  }
}

/** "Not interested" (and its Undo) moves the stored People row at once. Never throws. */
export async function setPipelineNotInterested(memberId: string, ni: boolean, mark: NiMark | null = null): Promise<PipelineRowUpdate | null> {
  return updatePipelineRow(memberId, { kind: 'ni', ni, mark })
}

/** The real tutors (People's default view, Not interested left out) whose card
 *  matches — the Overview to-do rows read this. */
export async function pipelineRows(pick: (p: PipeCard) => boolean): Promise<{ id: string; name: string; card: PipeCard }[]> {
  const [dir, pipe] = await Promise.all([loadDirectory(), loadTutorPipeline()])
  return inTab(dir.people, 'tutor', false)
    .map((t) => ({ id: t.id, name: t.name, card: pipe.get(t.id) }))
    .filter((r): r is { id: string; name: string; card: PipeCard } => !!r.card && !r.card.notInterested && pick(r.card))
}

/** After "Looks fine" (or its Undo) the stored People card shows the flag as it
 *  stands now (owner, 10 Nov 2026). Never throws. */
export async function refreshPipelineBlank(memberId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    const [{ data }, flags] = await Promise.all([
      admin.from('admin_list_rows').select('row').eq('list', LIST).eq('member_id', memberId).maybeSingle(),
      blankPhotoFlags([memberId]),
    ])
    const row = (data?.row ?? null) as { pipe?: PipeCard } | null
    if (!data || !row?.pipe) return
    await admin
      .from('admin_list_rows')
      .update({ row: { ...row, pipe: { ...row.pipe, blank: flags.get(memberId) ?? [] } } })
      .eq('list', LIST)
      .eq('member_id', memberId)
  } catch {
    /* the next summary run puts it right */
  }
}

/** An erase was scheduled (dueAt) or cancelled (null) — PR-04. The member's
 *  stored People row leaves (or returns to) every counted list at once, and
 *  the stored badges / Overview to-dos move with it. The next summary run
 *  recomputes everything else. Never throws. */
export async function setPeopleEraseRequested(memberId: string, dueAt: string | null): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    for (const list of ['people:tutor', 'people:parent']) {
      const { data } = await admin.from('admin_list_rows').select('tags, row').eq('list', list).eq('member_id', memberId).maybeSingle()
      if (!data) continue
      const tags = (data.tags ?? {}) as Record<string, unknown>
      const row = (data.row ?? {}) as Record<string, unknown> & { pipe?: PipeCard | null }
      const move = eraseMovesCount(tags, dueAt)
      // A cancel clears the erase date; any other badge comes back with the next summary run.
      const nextRow = { ...row, badge: dueAt ? eraseDateLine(dueAt) : String(row.badge ?? '').startsWith('Erase on ') ? null : row.badge }
      await admin.from('admin_list_rows').update({ tags: eraseTags(tags, dueAt), row: nextRow }).eq('list', list).eq('member_id', memberId)
      if (list === LIST && row.pipe && move !== 'none') {
        const now = Date.now()
        await nudgeBadges(move === 'out' ? badgeDelta(row.pipe, null, now, true) : badgeDelta(null, row.pipe, now, true))
      }
    }
  } catch {
    /* the next summary run puts it right */
  }
}
