// lib/parentDocuments.ts
//
// A parent's document review (owner, 8 Oct 2026): load the two items (CNIC
// front + back, typed address) and record a staff decision on one of them.
// The ONE writer for parent decisions — the member page's Documents box and
// the Verification → Parents queue both call reviewParentDocument through
// /api/admin/parents/document-review, so the two screens cannot disagree.
//
// Rules are pure in lib/parentDocsCore.ts.

import { pageAll } from '@/lib/pageAll'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminRole } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import { formatName } from '@/lib/formatName'
import {
  type ParentDocFacts,
  type ParentDocItem,
  type ParentItemState,
  parentCnicState,
  parentAddressState,
  parentWaiting,
  parentVerified,
  canApproveParentItem,
  parentDecisionPatch,
} from '@/lib/parentDocsCore'

const PROFILE_COLS =
  'id, full_name, role, address, city, cnic_number, verification_state, verification_rejection_reason, verification_submitted_at, cnic_verified_at, address_status, address_reason, address_verified_at, whatsapp, phone_number, created_at, is_seed, is_banned, is_suspended, is_team_account'

export type ParentDocs = {
  parentId: string
  name: string
  address: string | null
  city: string | null
  cnicNumber: string | null
  cnicFrontId: string | null
  cnicBackId: string | null
  cnic: ParentItemState
  addressItem: ParentItemState
  verified: boolean
  waiting: string[]
  submittedAt: string | null
  whatsapp: string | null
}

type CnicDoc = { id: string; user_id: string; label: string | null }

function toDocs(p: Record<string, unknown>, docs: CnicDoc[]): ParentDocs {
  const mine = docs.filter((d) => d.user_id === p.id)
  // A row written before the front/back split has no label and is the front.
  const front = mine.find((d) => d.label !== 'back') ?? null
  const back = mine.find((d) => d.label === 'back') ?? null
  const facts: ParentDocFacts = {
    verification_state: p.verification_state as string | null,
    verification_rejection_reason: p.verification_rejection_reason as string | null,
    cnic_verified_at: p.cnic_verified_at as string | null,
    address: p.address as string | null,
    address_status: p.address_status as string | null,
    address_reason: p.address_reason as string | null,
    address_verified_at: p.address_verified_at as string | null,
    hasCnicFront: !!front,
    hasCnicBack: !!back,
  }
  return {
    parentId: p.id as string,
    name: formatName(p.full_name as string | null) || 'Unnamed parent',
    address: (p.address as string | null) ?? null,
    city: (p.city as string | null) ?? null,
    cnicNumber: (p.cnic_number as string | null) ?? null,
    cnicFrontId: front?.id ?? null,
    cnicBackId: back?.id ?? null,
    cnic: parentCnicState(facts),
    addressItem: parentAddressState(facts),
    verified: parentVerified(facts),
    waiting: parentWaiting(facts),
    submittedAt: (p.verification_submitted_at as string | null) ?? null,
    whatsapp: (p.whatsapp as string | null) ?? (p.phone_number as string | null) ?? null,
  }
}

async function cnicDocsFor(ids: string[]): Promise<CnicDoc[]> {
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return []
  const { data } = await admin
    .from('user_documents')
    .select('id, user_id, label, created_at')
    .eq('kind', 'cnic')
    .eq('status', 'active')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
  return (data ?? []).map((d) => ({ id: d.id as string, user_id: d.user_id as string, label: (d.label as string | null) ?? null }))
}

/** One parent's documents, or null when the account is not a parent. */
export async function loadParentDocs(parentId: string): Promise<ParentDocs | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: p } = await admin.from('profiles').select(PROFILE_COLS).eq('id', parentId).maybeSingle()
  if (!p || (p.role !== 'parent' && p.role !== 'academy')) return null
  return toDocs(p as Record<string, unknown>, await cnicDocsFor([parentId]))
}

/**
 * Every parent with at least one item waiting for a decision, OLDEST
 * submission first. Fixtures, banned and suspended accounts are left out (the
 * tutor queue's rule). This list is the Parents queue's "Awaiting review" tab
 * AND the parent half of the Overview "Documents to approve" row.
 */
export async function parentsAwaitingReview(): Promise<ParentDocs[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const data = await pageAll((from, to) =>
    admin
      .from('profiles')
      .select(PROFILE_COLS)
      .in('role', ['parent', 'academy'])
      .or('verification_state.eq.submitted,address_status.eq.pending')
      .order('id')
      .range(from, to),
  )
  const live = (data as unknown as Record<string, unknown>[]).filter((p) => !p.is_seed && !p.is_banned && !p.is_suspended && !p.is_team_account)
  const docs = await cnicDocsFor(live.map((p) => p.id as string))
  const rows = live.map((p) => toDocs(p as Record<string, unknown>, docs)).filter((r) => r.waiting.length > 0)
  const key = (r: ParentDocs, p?: Record<string, unknown>) => r.submittedAt ?? (p?.created_at as string) ?? ''
  const created = new Map(live.map((p) => [p.id as string, p as Record<string, unknown>]))
  rows.sort((a, b) => key(a, created.get(a.parentId)).localeCompare(key(b, created.get(b.parentId))))
  return rows
}

const ITEM_LABEL: Record<ParentDocItem, string> = { cnic: 'CNIC', address: 'address' }

/**
 * A staff decision on one item. Service-role write; audit row, member timeline,
 * in-app notification and email. When this decision completes BOTH items the
 * parent is verified at once (entitlements read cnic_verified_at +
 * address_verified_at), so they can message tutors and request demos.
 */
export async function reviewParentDocument(params: {
  actor: { id: string; adminRole: AdminRole; email: string | null }
  parentId: string
  item: ParentDocItem
  decision: 'approve' | 'reject'
  reason: string
}): Promise<{ ok: true; verified: boolean } | { ok: false; status: number; error: string }> {
  const { actor, parentId, item, decision } = params
  const reason = params.reason.trim()
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  if (decision === 'reject' && reason.length < 3) {
    return { ok: false, status: 400, error: 'A reason is required to reject.' }
  }

  const before = await loadParentDocs(parentId)
  if (!before) return { ok: false, status: 404, error: 'That account is not a parent.' }

  const facts: ParentDocFacts = {
    address: before.address,
    hasCnicFront: !!before.cnicFrontId,
    hasCnicBack: !!before.cnicBackId,
  }
  if (decision === 'approve' && !canApproveParentItem(item, facts)) {
    return {
      ok: false,
      status: 400,
      error:
        item === 'cnic'
          ? 'Both sides of the CNIC must be uploaded before it can be approved.'
          : 'No address has been entered yet, so it cannot be approved.',
    }
  }

  const current = item === 'cnic' ? before.cnic : before.addressItem
  // Idempotent: approving what is already approved writes and logs nothing.
  if (decision === 'approve' && current.status === 'approved') return { ok: true, verified: before.verified }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    ...parentDecisionPatch(item, decision, reason, now),
    ...(item === 'cnic'
      ? { cnic_reviewed_by: actor.id, cnic_reviewed_at: now }
      : { address_reviewed_by: actor.id, address_reviewed_at: now }),
  }
  const { error } = await admin.from('profiles').update(patch).eq('id', parentId)
  if (error) return { ok: false, status: 400, error: error.message }

  const after = await loadParentDocs(parentId)
  const verified = !!after?.verified
  const approved = decision === 'approve'
  const label = ITEM_LABEL[item]

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: approved ? 'parent.verify.approve' : 'parent.verify.reject',
    targetType: 'profile',
    targetId: parentId,
    detail: { item, decision, reason: approved ? null : reason, from: current.status, verified },
  })

  await logActivity({
    userId: parentId,
    event: 'verification_decision_received',
    targetType: 'profile',
    targetId: parentId,
    meta: { item, decision, reason: approved ? null : reason, verified },
  })

  const verifyHref = '/parent/verify'
  if (!approved) {
    await notify({
      userId: parentId,
      kind: 'verification_rejected',
      title: `Your ${label} needs another look`,
      body: `Your ${label} was not approved: ${reason} Please correct it on your verification page.`,
      href: verifyHref,
    })
    const mailed = await deliverEmail(
      { userId: parentId },
      { id: 'verification_rejected', name: before.name, what: label, reason, href: verifyHref, audience: 'parent' },
    )
    if (!mailed.ok) console.info('[parent-review] rejection email not sent:', mailed.reason, parentId)
  } else if (verified && !before.verified) {
    await notify({
      userId: parentId,
      kind: 'verification_approved',
      title: 'You are verified',
      body: 'Your CNIC and address are approved. Your green Verified badge is now on your profile.',
      href: '/browse/tutors',
    })
    const mailed = await deliverEmail(
      { userId: parentId },
      { id: 'verification_decision', name: before.name, decision: 'approved', subjectOfDecision: 'cnic', reason: '' },
    )
    if (!mailed.ok) console.info('[parent-review] approval email not sent:', mailed.reason, parentId)
  } else {
    await notify({
      userId: parentId,
      kind: 'verification_approved',
      title: `Your ${label} is approved`,
      body:
        item === 'cnic'
          ? 'Your CNIC is approved. Your address is the last step before you are verified.'
          : 'Your address is approved. Your CNIC is the last step before you are verified.',
      href: verifyHref,
    })
  }

  return { ok: true, verified }
}
