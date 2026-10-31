import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import { loadStaffApprovals } from '@/lib/staffReceipt'
import { formatDateTime } from '@/lib/datetime'
import { planLabel } from '@/lib/display'
import StaffApprovalUndo from './StaffApprovalUndo'

// Payments → Approved by staff (owner, 31 Oct 2026): every bank-transfer
// receipt Backend Support approved under the matched-credit rule. The Owner
// can undo any of them (the badge and the revenue entry go; logged); the
// Partner views. The daily bell line links here.

export const dynamic = 'force-dynamic'

export default async function StaffApprovedPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.finance)
  const rows = await loadStaffApprovals({ includeUndone: true })
  const owner = canApprove(actor.adminRole)
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Approved by staff</h1>
        <p className="text-xs text-gray-500">
          Receipts Backend Support approved because a matching bank credit was in Finance. Undo puts the payment back to
          waiting: the badge and the revenue entry are removed, and the bank credit goes back to Needs attention.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No staff approvals yet. When Backend Support approves a matched receipt, it appears here and in your daily bell.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-tm-navy">{r.memberName || 'A member'} · {planLabel(r.planCode ?? '')}</p>
                <p className="text-gray-600">
                  {r.ref} · approved by {r.staffName || 'staff'} · {formatDateTime(r.approvedAt)}
                </p>
              </div>
              {r.undoneAt ? (
                <span className="font-bold text-tm-red">Undone {formatDateTime(r.undoneAt)}</span>
              ) : owner ? (
                <StaffApprovalUndo paymentId={r.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
