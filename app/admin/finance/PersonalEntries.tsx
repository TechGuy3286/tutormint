'use client'

// The bank credits marked "Not business (personal)" (owner, 10 Nov 2026),
// listed under Finance → Month by month. Left out of every figure. Undo is the
// Owner's alone (useCanApprove; the server checks too).

import { useCanApprove } from '@/components/admin/ReadOnly'
import { usePersonalCredit } from '@/components/admin/usePersonalCredit'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { pkr } from '@/lib/reconciliationCore'
import { personalMonthLine, type PersonalMonth } from '@/lib/personalCreditCore'

export default function PersonalEntries({ months, monthName }: { months: PersonalMonth[]; monthName: Record<string, string> }) {
  const isOwner = useCanApprove()
  const { busy, send } = usePersonalCredit()
  if (months.length === 0) return null
  return (
    <div id="personal" className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3" data-personal-list="">
      <p className="text-xs font-bold text-slate-700">Not business (personal) — left out of every figure above</p>
      {months.map((m) => (
        <div key={m.month} id={`personal-${m.month}`} className="space-y-1">
          <p className="text-[11px] font-bold text-gray-600">
            {monthName[m.month] ?? m.month} · {personalMonthLine(m)}
          </p>
          <ul className="space-y-1">
            {m.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                <span>
                  {formatDate(e.date)} · {pkr(e.amountPkr)}
                  {e.note ? ` · ${e.note}` : ''}
                  <span className="text-gray-500">
                    {' '}
                    · marked{e.byName ? ` by ${e.byName}` : ''} on {formatDateTime(e.markedAt)}
                  </span>
                </span>
                {isOwner && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void send(e.id, 'undo')}
                    className="min-h-[36px] rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-gray-50"
                  >
                    {busy === e.id ? 'Undoing…' : 'Undo'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
