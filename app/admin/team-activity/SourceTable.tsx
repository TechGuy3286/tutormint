import { loadSourceTable } from '@/lib/staffSignups'
import type { SourceRow } from '@/lib/staffSignupsCore'
import type { AdminActor } from '@/lib/adminAuth'

// Team activity → Paid sign-ups → "Sign-ups by source" (owner, 23 Oct 2026).
// Per staff member: how each credit was given — a link (any page opened with
// ?ref, /join?ref or /join/<name>), the old code box, or an approved claim —
// and tutors who paid in the last 7 and 30 days and all time. Counts only;
// staff and test accounts are left out. Owner, Project Managers and Admin see
// everyone and the team total; other staff see their own row.

const NUM = 'px-2 py-1.5 text-right tabular-nums'

function Row({ r, total = false }: { r: SourceRow; total?: boolean }) {
  return (
    <tr className={total ? 'border-t-2 border-gray-200 font-black text-tm-navy' : 'border-t border-gray-100 text-slate-800'}>
      <th scope="row" className="px-2 py-1.5 text-left font-bold">{r.name}</th>
      <td className={NUM}>{r.link}</td>
      <td className={NUM}>{r.code}</td>
      <td className={NUM}>{r.claim}</td>
      <td className={`${NUM} font-bold`}>{r.total}</td>
      <td className={NUM}>{r.paid7}</td>
      <td className={NUM}>{r.paid30}</td>
      <td className={`${NUM} font-bold`}>{r.paidAll}</td>
    </tr>
  )
}

export default async function SourceTable({ actor }: { actor: AdminActor }) {
  const { rows, total } = await loadSourceTable(actor)
  if (rows.length === 0) return null
  return (
    <details className="rounded-2xl border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-black text-tm-navy">Sign-ups by source</summary>
      <p className="mt-1 text-xs text-gray-600">
        All sign-ups credited to each person, by how they were credited. Tutors paid is counted on the day the
        Verification Fee was approved.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-gray-600">
              <th scope="col" className="px-2 py-1 text-left font-bold">Staff</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Link</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Code</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Claim</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">All sources</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">Tutors paid · 7 days</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">30 days</th>
              <th scope="col" className="px-2 py-1 text-right font-bold">All time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.staffId} r={r} />
            ))}
            {total && <Row r={total} total />}
          </tbody>
        </table>
      </div>
    </details>
  )
}
