import { STAFF_METRICS, type StaffCounts } from '@/lib/staffActivityCore'

// One staff member's activity, read from admin_audit_log by actor (PR29 §2).
// Five metrics down, three windows across. Brand tokens only; a plain table so
// it reads on a phone. The counts are computed in lib/staffActivityCore.

export default function StaffActivityTable({ counts }: { counts: StaffCounts }) {
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
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{w.today}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{w.week}</td>
                <td className="py-1.5 pl-2 text-right font-black tabular-nums text-tm-navy">{w.total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
