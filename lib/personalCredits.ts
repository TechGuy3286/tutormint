import 'server-only'

// lib/personalCredits.ts — "Not business (personal)" on a bank credit (owner,
// 10 Nov 2026; migration 228). Rules in lib/personalCreditCore.ts. OWNER ONLY:
// the route checks before calling. Service role. Nothing is deleted: a mark
// stamps personal_*; Undo clears personal_at and stamps personal_undone_*.
// Both write admin_audit_log (settlement.personal / settlement.personal_undo)
// with the amount and the note — never an account number.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import type { Actor } from '@/lib/settlementMatch'
import { personalMarkProblem, personalUndoProblem, type PersonalEntry } from '@/lib/personalCreditCore'

type Result = { ok: true } | { ok: false; status: number; error: string }
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

export async function markPersonal(input: { transferId: string; note: string }, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: t } = await admin.from('bank_transfers').select('id, amount_pkr, transferred_on, personal_at').eq('id', input.transferId).maybeSingle()
  const problem = personalMarkProblem(t ? { personalAt: (t.personal_at as string | null) ?? null } : null, input.note)
  if (problem) return { ok: false, ...problem }
  const note = input.note.trim()
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const { error } = await admin
    .from('bank_transfers')
    .update({
      personal_at: new Date().toISOString(),
      personal_by: actor.id,
      personal_by_name: formatName((me?.full_name as string | null) ?? '') || null,
      personal_note: note,
    })
    .eq('id', input.transferId)
    .is('personal_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.personal',
    targetType: 'bank_transfer',
    targetId: input.transferId,
    detail: { amountPkr: Number(t!.amount_pkr) || 0, date: String(t!.transferred_on), note },
  })
  return { ok: true }
}

export async function undoPersonal(input: { transferId: string }, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: t } = await admin.from('bank_transfers').select('id, amount_pkr, transferred_on, personal_at, personal_note').eq('id', input.transferId).maybeSingle()
  const problem = personalUndoProblem(t ? { personalAt: (t.personal_at as string | null) ?? null } : null)
  if (problem) return { ok: false, ...problem }
  const { error } = await admin
    .from('bank_transfers')
    .update({ personal_at: null, personal_undone_at: new Date().toISOString(), personal_undone_by: actor.id })
    .eq('id', input.transferId)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.personal_undo',
    targetType: 'bank_transfer',
    targetId: input.transferId,
    detail: { amountPkr: Number(t!.amount_pkr) || 0, date: String(t!.transferred_on), earlierNote: (t!.personal_note as string | null) ?? null },
  })
  return { ok: true }
}

/** Every credit marked personal now, for the Finance month lines. */
export async function loadPersonalEntries(): Promise<PersonalEntry[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const rows = await pageAll<{ id: string; transferred_on: string; amount_pkr: number; personal_note: string | null; personal_by_name: string | null; personal_at: string }>((from, to) =>
    admin
      .from('bank_transfers')
      .select('id, transferred_on, amount_pkr, personal_note, personal_by_name, personal_at')
      .not('personal_at', 'is', null)
      .order('id')
      .range(from, to),
  )
  return rows.map((r) => ({
    id: String(r.id),
    date: String(r.transferred_on),
    amountPkr: Number(r.amount_pkr) || 0,
    note: r.personal_note,
    byName: r.personal_by_name,
    markedAt: String(r.personal_at),
  }))
}
