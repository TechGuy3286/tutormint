import 'server-only'

// lib/docDecisionGate.ts — the server half of lib/docDecisionCore (owner,
// 5 Nov 2026), shared by the tutor and parent document-review routes.
//
//   beginDocDecision()  before the review: refuses anyone who may not decide
//                       (the Owner hears of the attempt), and for a staff
//                       decider applies the Owner-only cases; returns the
//                       state to keep for the Owner's Undo.
//   finishDocDecision() after a successful review: records a staff decision
//                       (with before/after), or for the Owner clears a
//                       "Name does not match" mark on the CNIC.

import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { alertOwnerBlocked } from '@/lib/ownerAlerts'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { docDecider, staffDocRefusal, type DecisionState, type DocDecider } from '@/lib/docDecisionCore'
import { loadDocumentStatuses } from '@/lib/tutorDocuments'
import { loadParentDocs } from '@/lib/parentDocuments'
import { captureDecisionState, recordStaffDecision, markCnicNameMismatch } from '@/lib/staffDocDecisions'
import type { AdminRole } from '@/lib/adminAccessCore'

type Actor = { id: string; adminRole: AdminRole; email: string | null }

export type DocDecisionStart = {
  decider: DocDecider
  memberRole: string | null
  rereview: boolean
  before: DecisionState | null
}

export async function beginDocDecision(args: {
  actor: Actor
  memberId: string
  item: 'cnic' | 'profile_pic' | 'selfie' | 'address'
  decision: 'approve' | 'reject'
  nameChecked: boolean
  what: string
}): Promise<{ ok: true; start: DocDecisionStart } | { ok: false; response: NextResponse }> {
  const decider = docDecider(args.actor.adminRole)
  if (!decider) {
    const refused = await refuseUnlessOwnerApproval(args.actor, args.what, args.memberId)
    return { ok: false, response: refused ?? NextResponse.json({ error: 'Not allowed.' }, { status: 403 }) }
  }
  const admin = createAdminClient()
  const { data: p } = admin
    ? await admin.from('profiles').select('role, name_rereview_at, cnic_name_mismatch_at').eq('id', args.memberId).maybeSingle()
    : { data: null }
  const memberRole = (p?.role as string | null) ?? null

  let status: 'none' | 'pending' | 'approved' | 'rejected' = 'none'
  let rereview = false
  if (args.item === 'address' || (args.item === 'cnic' && memberRole !== 'tutor')) {
    const docs = await loadParentDocs(args.memberId, { allowTutor: true })
    const st = args.item === 'address' ? docs?.addressItem : docs?.cnic
    status = (st?.status as typeof status) ?? 'none'
    rereview = !!st?.rereview
  } else {
    const all = await loadDocumentStatuses(args.memberId)
    const st = args.item === 'cnic' ? all.cnic : args.item === 'profile_pic' ? all.profilePic : all.selfie
    status = st.status
    rereview = !!st.rereview
  }

  if (decider === 'staff') {
    const refusal = staffDocRefusal({
      item: args.item,
      decision: args.decision,
      status,
      rereview,
      nameFlagged: !!p?.name_rereview_at,
      nameMismatch: !!p?.cnic_name_mismatch_at,
      nameChecked: args.nameChecked,
    })
    if (refusal) {
      // Asking to tick the name box is a normal step, not a blocked attempt.
      if (!/tick the box/.test(refusal)) {
        await alertOwnerBlocked({
          actor: { id: args.actor.id, adminRole: args.actor.adminRole, email: args.actor.email ?? null },
          problem: refusal,
          what: args.what,
          targetId: args.memberId,
        })
      }
      return { ok: false, response: NextResponse.json({ error: refusal }, { status: 403 }) }
    }
  }
  const before = args.item === 'address' || decider === 'owner' ? null : await captureDecisionState(args.memberId, args.item)
  return { ok: true, start: { decider, memberRole, rereview, before } }
}

export async function finishDocDecision(args: {
  actor: Actor
  memberId: string
  item: 'cnic' | 'profile_pic' | 'selfie' | 'address'
  decision: 'approve' | 'reject'
  reason: string | null
  start: DocDecisionStart
}): Promise<void> {
  if (args.item === 'address') return
  if (args.start.decider === 'owner') {
    // The Owner's decision on a CNIC settles a "Name does not match" mark.
    if (args.item === 'cnic') {
      const admin = createAdminClient()
      const { data } = admin ? await admin.from('profiles').select('cnic_name_mismatch_at').eq('id', args.memberId).maybeSingle() : { data: null }
      if (data?.cnic_name_mismatch_at) await markCnicNameMismatch(args.memberId, false, args.actor)
    }
    return
  }
  if (!args.start.before) return
  const after = await captureDecisionState(args.memberId, args.item)
  if (!after) return
  await recordStaffDecision({
    actor: args.actor,
    memberId: args.memberId,
    memberRole: args.start.memberRole,
    item: args.item,
    decision: args.decision,
    rereview: args.start.rereview,
    reason: args.decision === 'reject' ? args.reason : null,
    before: args.start.before,
    after,
  })
}
