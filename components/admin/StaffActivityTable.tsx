import Link from 'next/link'

import { STAFF_METRICS, type StaffCounts, type StaffMetricKey } from '@/lib/staffActivityCore'

// One staff member's activity, read from admin_audit_log by actor (PR29 §2).
// Four metrics down, three windows across. Brand tokens only; a plain table so
// it reads on a phone. The counts are computed in lib/staffActivityCore.
//
// PR40 §4 — when `staffId` is given, every number links to that staff member's
// detail page filtered to that action and window (today / 7 days / total). A
// zero still renders (as a plain, unlinked number: nothing to open).

function cell(staffId: string | undefined, metric: StaffMetricKey, period: 'today' | 'week' | 'all', value: number, strong = false) {
  const cls = strong
    ? 'font-black tabular-nums text-tm-navy'
    : 'tabular-nums text-slate-700'
  if (!staffId || value === 0) return <span className={cls}>{value}</span>
  return (
    <Link
      href={`/admin/staff-activity/${staffId}?action=${metric}&period=${period}`}
      className={`${cls} hover:text-tm-red hover:underline`}
    >
      {value}
    </Link>
  )
}

export default function StaffActivityTable({
  counts,
  staffId,
}: {
  counts: StaffCounts
  /** When set, each number links to the filtered staff detail page. */
  staffId?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="py-1.5 pr-2 font-black uppercase tracking-wide text-gray-500">Action</th>
            <th className="px-2 py-1.5 text-right font-black uppercase tracking-wide text-gray-500">Today</th>
            <th className="px-2 py-1.5 text-right font-black uppercase tracking-wide text-gray-500">7 days</th>
            <th className="py-1.5 pl-2 text-right font-black uppercase tracking-wide text-gray-500">Total</th>
          </tr>
        </thead>
        <tbody>
          {STAFF_METRICS.map((m) => {
            const w = counts[m.key]
            return (
              <tr key={m.key} className="border-b border-gray-100 last:border-0">
                <td className="py-1.5 pr-2 font-semibold text-tm-navy">{m.label}</td>
                <td className="px-2 py-1.5 text-right">{cell(staffId, m.key, 'today', w.today)}</td>
                <td className="px-2 py-1.5 text-right">{cell(staffId, m.key, 'week', w.week)}</td>
                <td className="py-1.5 pl-2 text-right">{cell(staffId, m.key, 'all', w.total, true)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
