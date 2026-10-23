import Link from 'next/link'
import { Users } from 'lucide-react'

import type { TeamOverviewRow } from '@/lib/teamOverviewCore'

// The Team overview card (owner, 24 Oct 2026): for the Owner, the Project
// Managers and Supervisors. Per staff member: overdue Applications on their
// tuitions, red rows in Paid tutors in their cities, and follow-ups they sent
// today and in the last 7 days (Pakistan time). Each number opens the list.

const NUM = 'px-2 py-1.5 text-right tabular-nums'

export default function TeamOverviewView({ rows }: { rows: TeamOverviewRow[] }) {
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="team-overview" className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 id="team-overview" className="flex items-center gap-2 text-sm font-black text-tm-navy">
        <Users aria-hidden size={16} /> Team overview
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="text-gray-600">
              <th scope="col" className="px-2 py-1 text-left font-bold">Staff</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Overdue applications</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Red paid tutors</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Follow-ups today</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Last 7 days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.staffId} className="border-t border-gray-100 text-slate-800">
                <th scope="row" className="px-2 py-1.5 text-left font-bold">{r.name}</th>
                <td className={`${NUM} ${r.overdueApplications ? 'font-black text-tm-red' : ''}`}>
                  <Link href={`/admin/applications?staff=${r.staffId}`} className="hover:underline">
                    {r.overdueApplications}
                  </Link>
                </td>
                <td className={`${NUM} ${r.redPaidTutors ? 'font-black text-tm-red' : ''}`}>
                  <Link href={`/admin/paid-tutors?staff=${r.staffId}&show=red`} className="hover:underline">
                    {r.redPaidTutors}
                  </Link>
                </td>
                <td className={NUM}>{r.followUpsToday}</td>
                <td className={NUM}>{r.followUps7}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
