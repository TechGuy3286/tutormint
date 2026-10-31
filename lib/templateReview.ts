// lib/templateReview.ts
//
// The server half of Team inbox → Templates → Review new wording (owner,
// 28 Oct 2026). The Owner reads each template's LIVE wording beside its
// PROPOSED simple-English wording (lib/templateProposals) and decides:
//
//   Approve            the proposed wording goes live
//   Edit then approve  the Owner's edited wording goes live (it must still
//                      follow the writing rules, and keep the Urdu as it is)
//   Keep current       the live wording stays; recorded as decided
//   Approve all        every template not decided yet, as proposed
//   Restore            a wording from the template's history goes live again
//
// Whenever a live wording changes here, the wording it replaces is kept in
// template_history first (nothing is deleted). WhatsApp / Team templates live
// in admin_message_templates.body; emails in email_wordings (no row = the
// built-in email). Every decision is in the Audit log. The routes check that
// only the Owner decides.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { TUITION_LIVE_LABEL } from '@/lib/tuitionStatus'
import { RETIRED_TEMPLATE_KEYS } from '@/lib/templateRetireCore'
import { ALL_PROPOSALS as EVERY_PROPOSAL, NOT_REWRITTEN, checkWording, previewText, proposalFor, type Proposal } from '@/lib/templateProposals'

import { EMAIL_SAMPLE_INPUTS, emailWordingFor, type EmailVariant } from '@/lib/notify/emailWordingCore'
import { render, renderWording } from '@/lib/notify/templates'
import { clearEmailWordingCache } from '@/lib/notify/emailWording'
import { templateSaveCheck } from '@/lib/templateRules'
import { formatName } from '@/lib/formatName'
import { approvedWording } from '@/lib/templateResetCore'
import { pageAll } from '@/lib/pageAll'

// Retired templates (owner, 31 Oct 2026) are not reviewed: no code sends them.
const ALL_PROPOSALS = EVERY_PROPOSAL.filter((p) => !(RETIRED_TEMPLATE_KEYS as readonly string[]).includes(p.key))

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type ReviewStatus = 'pending' | 'approved' | 'kept'

export type HistoryRow = {
  id: string
  subject: string | null
  /** null = the built-in email wording. */
  body: string | null
  action: string
  savedAt: string
  savedByName: string | null
}

export type ReviewItem = {
  key: string
  kind: Proposal['kind']
  title: string
  recipient: Proposal['recipient']
  liveSubject: string | null
  liveBody: string
  /** The live text filled with sample data (emails: the email as read). */
  livePreview: string
  proposedSubject: string | null
  proposedBody: string
  proposedPreview: string
  button: string | null
  placeholders: readonly string[]
  /** Writing-rule problems of the proposed wording (empty = follows them). */
  problems: string[]
  status: ReviewStatus
  edited: boolean
  decidedAt: string | null
  decidedByName: string | null
  /** The live wording already equals the proposal. */
  isLive: boolean
  missing: boolean
  history: HistoryRow[]
}

export type ReviewBoard = { items: ReviewItem[]; notRewritten: typeof NOT_REWRITTEN; support: string }

const variantOf = (key: string) => key.replace(/^email:/, '') as EmailVariant

/** The email text as a member reads it, without the footer. */
function emailText(r: { subject: string; text: string }): string {
  const body = r.text.split('\n—\n')[0]?.trimEnd() ?? r.text
  return `Subject: ${r.subject}\n\n${body}`
}

function emailSample(variant: EmailVariant, support: string) {
  const input = EMAIL_SAMPLE_INPUTS[variant]
  const fill = emailWordingFor(input, TUITION_LIVE_LABEL)
  return { input, fill, values: { ...(fill?.values ?? {}), support_whatsapp: support } }
}

function renderStored(variant: EmailVariant, w: { subject: string; body: string }, support: string, button: string | null): string {
  const { input, fill, values } = emailSample(variant, support)
  return emailText(renderWording({ ...w, button }, values, fill?.href ?? null, render(input).essential))
}

async function nameOf(admin: Admin, id: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? null) || null
}

export async function loadReviewBoard(admin: Admin | null = createAdminClient()): Promise<ReviewBoard> {
  const support = await loadSupportWhatsApp(admin)
  if (!admin) return { items: [], notRewritten: NOT_REWRITTEN, support }
  const waKeys = ALL_PROPOSALS.filter((p) => p.kind !== 'email').map((p) => p.key)
  const [tpl, words, reviews, hist] = await Promise.all([
    admin.from('admin_message_templates').select('key, subject, body').in('key', waKeys),
    admin.from('email_wordings').select('variant, subject, body'),
    admin.from('template_reviews').select('key, status, edited, decided_at, decided_by_name'),
    admin.from('template_history').select('id, key, subject, body, action, saved_at, saved_by_name').order('saved_at', { ascending: false }).limit(1000),
  ])
  const tplBy = new Map((tpl.data ?? []).map((r) => [r.key as string, r]))
  const wordBy = new Map((words.data ?? []).map((r) => [r.variant as string, r]))
  const revBy = new Map((reviews.data ?? []).map((r) => [r.key as string, r]))
  const histBy = new Map<string, HistoryRow[]>()
  for (const h of hist.data ?? []) {
    const list = histBy.get(h.key as string) ?? []
    list.push({
      id: h.id as string,
      subject: (h.subject as string | null) ?? null,
      body: (h.body as string | null) ?? null,
      action: h.action as string,
      savedAt: h.saved_at as string,
      savedByName: (h.saved_by_name as string | null) ?? null,
    })
    histBy.set(h.key as string, list)
  }

  const items: ReviewItem[] = ALL_PROPOSALS.map((p) => {
    const rev = revBy.get(p.key)
    let liveSubject: string | null = null
    let liveBody = ''
    let livePreview = ''
    let proposedPreview = ''
    let missing = false
    if (p.kind === 'email') {
      const variant = variantOf(p.key)
      const stored = wordBy.get(variant)
      if (stored) {
        liveSubject = stored.subject as string
        liveBody = stored.body as string
        livePreview = renderStored(variant, { subject: liveSubject, body: liveBody }, support, p.button ?? null)
      } else {
        const r = render(EMAIL_SAMPLE_INPUTS[variant])
        liveSubject = r.subject
        liveBody = emailText(r)
        livePreview = liveBody
      }
      proposedPreview = renderStored(variant, { subject: p.subject ?? '', body: p.body }, support, p.button ?? null)
    } else {
      const row = tplBy.get(p.key)
      missing = !row
      liveSubject = (row?.subject as string | null) ?? null
      liveBody = (row?.body as string | null) ?? ''
      livePreview = previewText(liveBody, support)
      proposedPreview = previewText(p.body, support)
    }
    return {
      key: p.key,
      kind: p.kind,
      title: p.title,
      recipient: p.recipient,
      liveSubject,
      liveBody,
      livePreview,
      proposedSubject: p.subject ?? null,
      proposedBody: p.body,
      proposedPreview,
      button: p.button ?? null,
      placeholders: p.allowed,
      problems: checkWording(p, p.kind === 'email' ? null : liveBody),
      status: (rev?.status as ReviewStatus | undefined) ?? 'pending',
      edited: !!rev?.edited,
      decidedAt: (rev?.decided_at as string | null) ?? null,
      decidedByName: (rev?.decided_by_name as string | null) ?? null,
      isLive: p.kind === 'email' ? wordBy.get(variantOf(p.key))?.body === p.body : liveBody === p.body,
      missing,
      history: histBy.get(p.key) ?? [],
    }
  })
  return { items, notRewritten: NOT_REWRITTEN, support }
}

type Result = { ok: true } | { ok: false; status: number; error: string; problems?: string[] }

/** What the history row records: the wording about to be replaced. */
async function currentWording(admin: Admin, p: Proposal): Promise<{ subject: string | null; body: string | null } | null> {
  if (p.kind === 'email') {
    const { data } = await admin.from('email_wordings').select('subject, body').eq('variant', variantOf(p.key)).maybeSingle()
    return { subject: (data?.subject as string | null) ?? null, body: (data?.body as string | null) ?? null }
  }
  const { data } = await admin.from('admin_message_templates').select('subject, body').eq('key', p.key).maybeSingle()
  if (!data) return null
  return { subject: (data.subject as string | null) ?? null, body: (data.body as string | null) ?? '' }
}

/** Put a wording live (after keeping the one it replaces). */
async function goLive(
  admin: Admin,
  actor: AdminActor,
  actorName: string | null,
  p: Proposal,
  next: { subject: string | null; body: string | null },
  action: 'approve' | 'restore',
): Promise<Result> {
  const cur = await currentWording(admin, p)
  if (!cur) return { ok: false, status: 404, error: 'This template is not set up yet, so there is nothing to change.' }
  const now = new Date().toISOString()
  const { error: hErr } = await admin.from('template_history').insert({
    key: p.key,
    kind: p.kind,
    subject: cur.subject,
    body: cur.body,
    action,
    saved_by: actor.id,
    saved_by_name: actorName,
    saved_at: now,
  })
  if (hErr) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  if (p.kind === 'email') {
    const variant = variantOf(p.key)
    const { error } =
      next.body == null
        ? await admin.from('email_wordings').delete().eq('variant', variant)
        : await admin
            .from('email_wordings')
            .upsert({ variant, subject: next.subject ?? p.subject ?? '', body: next.body, updated_by: actor.id, updated_at: now }, { onConflict: 'variant' })
    if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
    clearEmailWordingCache()
  } else {
    const { error } = await admin
      .from('admin_message_templates')
      .update({ body: next.body ?? '', updated_by: actor.id, updated_at: now })
      .eq('key', p.key)
    if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  }
  return { ok: true }
}

/** The checks an approved wording must pass: the writing rules (Urdu kept as live) and the editor's placeholder check. */
function approvalProblems(p: Proposal, body: string, subject: string | null, liveBody: string | null): string[] {
  const probs = checkWording({ ...p, body, subject: subject ?? p.subject }, p.kind === 'email' ? null : liveBody)
  if (p.kind !== 'email') {
    const save = templateSaveCheck(p.key, body)
    if (!save.ok) probs.push(save.error)
  }
  return probs
}

export async function decideTemplate(
  actor: AdminActor,
  key: string,
  action: 'approve' | 'keep',
  edit?: { body: string; subject?: string | null } | null,
  admin: Admin | null = createAdminClient(),
): Promise<Result> {
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const p = proposalFor(key)
  if (!p) return { ok: false, status: 404, error: 'That template is not in the review list.' }
  const actorName = await nameOf(admin, actor.id)
  const edited = !!edit && (edit.body.trim() !== p.body.trim() || (edit.subject ?? p.subject ?? null) !== (p.subject ?? null))

  if (action === 'approve') {
    const body = (edit?.body ?? p.body).replace(/\r\n/g, '\n').trim()
    const subject = p.kind === 'email' ? ((edit?.subject ?? p.subject ?? '').trim() || null) : null
    const cur = await currentWording(admin, p)
    const problems = approvalProblems(p, body, subject, cur?.body ?? null)
    if (problems.length) return { ok: false, status: 400, error: 'This wording does not follow the writing rules yet.', problems }
    const res = await goLive(admin, actor, actorName, p, { subject, body }, 'approve')
    if (!res.ok) return res
  }
  const { error } = await admin.from('template_reviews').upsert(
    {
      key,
      status: action === 'approve' ? 'approved' : 'kept',
      edited: action === 'approve' && edited,
      decided_by: actor.id,
      decided_by_name: actorName,
      decided_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: action === 'approve' ? 'template.review_approve' : 'template.review_keep',
    targetType: p.kind === 'email' ? 'email_wording' : 'admin_message_template',
    targetId: key,
    detail: { key, edited: action === 'approve' && edited },
  })
  return { ok: true }
}

/** Approve every template that has not been decided yet, as proposed. */
export async function approveAllPending(actor: AdminActor, admin: Admin | null = createAdminClient()): Promise<{ ok: true; approved: string[]; skipped: { key: string; why: string }[] } | { ok: false; status: number; error: string }> {
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data } = await admin.from('template_reviews').select('key')
  const decided = new Set((data ?? []).map((r) => r.key as string))
  const approved: string[] = []
  const skipped: { key: string; why: string }[] = []
  for (const p of ALL_PROPOSALS) {
    if (decided.has(p.key)) continue
    const res = await decideTemplate(actor, p.key, 'approve', null, admin)
    if (res.ok) approved.push(p.key)
    else skipped.push({ key: p.key, why: res.problems?.join(' ') || res.error })
  }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'template.review_approve_all',
    targetType: 'admin_message_template',
    targetId: 'all',
    detail: { approved: approved.length, skipped: skipped.length },
  })
  return { ok: true, approved, skipped }
}

/** Put a wording from a template's history back live. */
export async function restoreTemplate(actor: AdminActor, historyId: string, admin: Admin | null = createAdminClient()): Promise<Result> {
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: h } = await admin.from('template_history').select('key, subject, body').eq('id', historyId).maybeSingle()
  if (!h) return { ok: false, status: 404, error: 'That earlier wording was not found. Reload the page.' }
  const p = proposalFor(h.key as string)
  if (!p) return { ok: false, status: 404, error: 'That template is not in the review list.' }
  const actorName = await nameOf(admin, actor.id)
  const res = await goLive(admin, actor, actorName, p, { subject: (h.subject as string | null) ?? null, body: (h.body as string | null) ?? null }, 'restore')
  if (!res.ok) return res
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'template.restore',
    targetType: p.kind === 'email' ? 'email_wording' : 'admin_message_template',
    targetId: p.key,
    detail: { key: p.key, historyId, builtIn: h.body == null },
  })
  return { ok: true }
}

/** The regular editor keeps what it replaces too (owner, 28 Oct 2026). */
export async function recordEditHistory(actor: AdminActor, key: string, before: { subject: string | null; body: string }): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const kind = proposalFor(key)?.kind ?? 'whatsapp'
  await admin
    .from('template_history')
    .insert({ key, kind, subject: before.subject, body: before.body, action: 'edit', saved_by: actor.id, saved_by_name: await nameOf(admin, actor.id) })
    .then(
      () => undefined,
      () => undefined,
    )
}

/**
 * The approved wording of each WhatsApp / Team template the Owner approved
 * (owner, 28 Oct 2026) — what "Reset to default" puts back. Keys with no
 * approval are absent (Reset then uses the built-in code default). One read
 * of each table; a failed read returns an empty map (the old behaviour).
 */
export async function approvedTemplateBodies(admin: Admin | null = createAdminClient()): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!admin) return out
  try {
    const [rev, hist, tpl] = await Promise.all([
      admin.from('template_reviews').select('key, status, edited, decided_at').eq('status', 'approved'),
      pageAll((from, to) => admin.from('template_history').select('id, key, action, body, saved_at').order('saved_at', { ascending: true }).order('id').range(from, to)).then((data) => ({ data })),
      admin.from('admin_message_templates').select('key, body'),
    ])
    const history = new Map<string, { action: string; body: string | null; savedAt: string }[]>()
    for (const h of hist.data ?? []) {
      const k = h.key as string
      ;(history.get(k) ?? history.set(k, []).get(k)!).push({ action: h.action as string, body: (h.body as string | null) ?? null, savedAt: h.saved_at as string })
    }
    const live = new Map((tpl.data ?? []).map((t) => [t.key as string, (t.body as string | null) ?? null]))
    for (const r of rev.data ?? []) {
      const key = r.key as string
      if (key.startsWith('email:')) continue
      const body = approvedWording({
        review: { status: 'approved', edited: !!r.edited, decidedAt: r.decided_at as string },
        proposalBody: proposalFor(key)?.body ?? null,
        history: history.get(key) ?? [],
        currentBody: live.get(key) ?? null,
      })
      if (body) out.set(key, body)
    }
  } catch {
    /* keep the code defaults */
  }
  return out
}
