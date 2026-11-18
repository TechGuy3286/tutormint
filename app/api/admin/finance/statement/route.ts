import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import {
  ensureRowCredit,
  importStatement,
  linkRowToApproved,
  sameMoneyRow,
  undoSameMoneyRow,
  unlinkRow,
  markRowPersonal,
  reclassifyRow,
  resolveUnclearRow,
  revealRowAccount,
  undoReclassifyRow,
  undoRowPersonal,
} from '@/lib/bankStatement'
import { STATEMENT_CLASSES } from '@/lib/bankStatementCore'
import { parseBody, z } from '@/lib/validate'

// Finance → Import bank statement (owner, 17 Nov 2026 — PR-03). OWNER ONLY:
// the Finance gate (Owner + the view-only Partner, who is refused every write
// by checkAdminRole), then the Owner-only check, which refuses every other
// role 403 and alerts the Owner. Statement rows are never sent to any other
// role. Every action is audit-logged without names or account numbers.
//
//   POST multipart (file)        import a Faysal statement export
//   POST json { action, rowId }  reclassify / undo_class / personal /
//                                undo_personal / reveal / resolve /
//                                link_approved / unlink / same_money /
//                                undo_same / ensure_credit (PR-04)

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES = 8 * 1024 * 1024

const Json = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reclassify'), rowId: z.guid(), to: z.enum(STATEMENT_CLASSES as [string, ...string[]]) }),
  z.object({ action: z.literal('undo_class'), rowId: z.guid() }),
  z.object({ action: z.literal('personal'), rowId: z.guid(), note: z.string().min(3, 'Add a short note.').max(500, 'Keep the note under 500 characters.') }),
  z.object({ action: z.literal('undo_personal'), rowId: z.guid() }),
  z.object({ action: z.literal('reveal'), rowId: z.guid() }),
  z.object({ action: z.literal('resolve'), rowId: z.guid(), transferId: z.guid().nullable() }),
  // PR-04
  z.object({ action: z.literal('link_approved'), rowId: z.guid(), paymentId: z.guid() }),
  z.object({ action: z.literal('unlink'), rowId: z.guid() }),
  z.object({ action: z.literal('same_money'), rowId: z.guid(), transferId: z.guid() }),
  z.object({ action: z.literal('undo_same'), rowId: z.guid() }),
  z.object({ action: z.literal('ensure_credit'), rowId: z.guid() }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'import or change the bank statement', null)
  if (notOwner) return notOwner
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose the statement file.' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is too large (8 MB at most).' }, { status: 413 })
    const html = await file.text()
    const r = await importStatement(html, file.name || null, actor)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, outcome: r.outcome })
  }

  const parsed = await parseBody(request, Json)
  if (!parsed.ok) return parsed.response
  const d = parsed.data
  if (d.action === 'reveal') {
    const r = await revealRowAccount(d.rowId, actor)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, value: r.value }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  if (d.action === 'ensure_credit') {
    const e = await ensureRowCredit(d.rowId, actor)
    if (!e.ok) return NextResponse.json({ error: e.error }, { status: e.status })
    return NextResponse.json({ ok: true, transferId: e.transferId })
  }
  const r =
    d.action === 'link_approved'
      ? await linkRowToApproved(d.rowId, d.paymentId, actor)
      : d.action === 'unlink'
        ? await unlinkRow(d.rowId, actor)
        : d.action === 'same_money'
          ? await sameMoneyRow(d.rowId, d.transferId, actor)
          : d.action === 'undo_same'
            ? await undoSameMoneyRow(d.rowId, actor)
            : d.action === 'reclassify'
      ? await reclassifyRow(d.rowId, d.to as never, actor)
      : d.action === 'undo_class'
        ? await undoReclassifyRow(d.rowId, actor)
        : d.action === 'personal'
          ? await markRowPersonal(d.rowId, d.note, actor)
          : d.action === 'undo_personal'
            ? await undoRowPersonal(d.rowId, actor)
            : await resolveUnclearRow(d.rowId, d.transferId ? { kind: 'same', transferId: d.transferId } : { kind: 'new' }, actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
