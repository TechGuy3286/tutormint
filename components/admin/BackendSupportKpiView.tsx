// The Backend Support KPI card's markup (owner, 31 Oct 2026). Plain markup with
// no server imports, so it can be rendered on its own (screenshots, tests).

import Link from 'next/link'

import { forwardSpeedLabel, type BackendSupportKpi } from '@/lib/backendSupportKpiCore'

export default function BackendSupportKpiView({ kpi, name }: { kpi: BackendSupportKpi; name?: string | null }) {
  const tile = 'rounded-2xl border border-gray-200 bg-white p-3'
  const big = 'text-2xl font-black tabular-nums text-tm-navy'
  return (
    <section className="space-y-2" data-backend-support-kpi="">
      <h2 className="text-sm font-black text-tm-navy">{name ? `${name} — your numbers` : 'Your numbers'}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link href="/admin/follow-ups" className={tile}>
          <p className="text-[11px] font-bold text-gray-600">Follow-ups sent</p>
          <p className={big}>{kpi.followUpsToday}</p>
          <p className="text-[11px] text-gray-600">today · {kpi.followUps7} in 7 days</p>
        </Link>
        <Link href="/admin/applications?staff=all" className={tile}>
          <p className="text-[11px] font-bold text-gray-600">Overdue To do</p>
          <p className={`${big} ${kpi.overdueTodo > 0 ? 'text-tm-red' : ''}`}>{kpi.overdueTodo}</p>
          <p className="text-[11px] text-gray-600">applications</p>
        </Link>
        <Link href="/admin/paid-tutors" className={tile}>
          <p className="text-[11px] font-bold text-gray-600">Red Paid tutors</p>
          <p className={`${big} ${kpi.redPaidTutors > 0 ? 'text-tm-red' : ''}`}>{kpi.redPaidTutors}</p>
          <p className="text-[11px] text-gray-600">need you</p>
        </Link>
        <Link href="/admin/applications?staff=all" className={tile}>
          <p className="text-[11px] font-bold text-gray-600">Forwarded fast</p>
          <p className={big}>{kpi.forwardedWithin24h}</p>
          <p className="text-[11px] text-gray-600">{forwardSpeedLabel(kpi)}</p>
        </Link>
      </div>
    </section>
  )
}
