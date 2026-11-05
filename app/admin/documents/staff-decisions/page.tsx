import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import { DOC_LABEL } from '@/lib/docDecisionCore'
import { loadStaffDocDecisions, pkDayRange } from '@/lib/staffDocDecisions'
import { formatDateTime } from '@/lib/datetime'
import StaffDocUndo from './StaffDocUndo'

// Documents approved by staff (owner, 5 Nov 2026): every CNIC, profile picture
// and selfie decision Backend Support made. The Owner can undo any of them —
// the document goes back to waiting and any badge it gave is removed (logged);
// the Partner views. The daily bell line links here with ?day=.

export const dynamic = 'force-dynamic'

export default async function StaffDocDecisionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.staffDocDecisions)
  const sp = await searchParams
  const day = typeof sp.day === 'string' ? sp.day : ''
  const range = day ? pkDayRange(day) : null
  const rows = await loadStaffDocDecisions({ includeUndone: true, sinceIso: range?.[0], untilIso: range?.[1] })
  const owner = canApprove(actor.adminRole)
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Documents approved by staff</h1>
        <p className="text-xs text-gray-500">
          CNIC, profile picture and selfie decisions made by Backend Support. Undo puts the document back to waiting for
          review, and any badge it gave is removed.
        </p>
        <p className="text-xs font-semibold">
          {range ? (
            <>
              Showing {day} (Pakistan time) ·{' '}
              <Link href="/admin/documents/staff-decisions" className="text-tm-navy underline">
                Show every day
              </Link>
            </>
          ) : (
            'Showing every day'
          )}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No staff decisions {range ? 'on this day' : 'yet'}. When Backend Support approves or rejects a document, it appears
          here and in your daily bell.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-tm-navy">
                  <Link href={`/admin/users/${r.memberId}#documents`} className="hover:underline">
                    {r.memberName || 'A member'}
                  </Link>{' '}
                  · {r.rereview ? 'new ' : ''}
                  {DOC_LABEL[r.item]} {r.decision === 'approve' ? 'approved' : 'rejected'}
                </p>
                <p className="text-gray-600">
                  by {r.staffName || 'staff'} · {formatDateTime(r.decidedAt)}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              {r.undoneAt ? (
                <span className="font-bold text-tm-red">
                  Undone {formatDateTime(r.undoneAt)}
                  {r.undoneByName ? ` by ${r.undoneByName}` : ''}
                </span>
              ) : owner ? (
                <StaffDocUndo decisionId={r.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
