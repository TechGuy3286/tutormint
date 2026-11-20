'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PERIODS, type PeriodKey } from '@/lib/insightsCore'

// Admin → Insights period picker (PR-12): Today, Yesterday, Last 7 days, Last
// 30 days, or a custom range (Pakistan days). A custom range opens as soon as
// both dates are set — no extra button.

export default function PeriodPicker({ active, from, to, today }: { active: PeriodKey; from: string; to: string; today: string }) {
  const router = useRouter()
  const [f, setF] = useState(from)
  const [t, setT] = useState(to)
  const go = (nf: string, nt: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(nf) && /^\d{4}-\d{2}-\d{2}$/.test(nt)) router.push(`/admin/insights?period=custom&from=${nf}&to=${nt}`)
  }
  const chip = (on: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-xl border px-3 text-xs font-bold ${on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:bg-tm-bg'}`
  return (
    <div className="flex flex-wrap items-end gap-2">
      {PERIODS.map((p) => (
        <Link key={p.key} href={`/admin/insights?period=${p.key}`} className={chip(active === p.key)}>
          {p.label}
        </Link>
      ))}
      <label className="flex flex-col text-[11px] font-bold text-slate-700">
        From
        <input
          type="date"
          value={f}
          max={today}
          onChange={(e) => {
            setF(e.target.value)
            go(e.target.value, t)
          }}
          className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-2 text-sm font-bold text-tm-navy"
        />
      </label>
      <label className="flex flex-col text-[11px] font-bold text-slate-700">
        To
        <input
          type="date"
          value={t}
          max={today}
          onChange={(e) => {
            setT(e.target.value)
            go(f, e.target.value)
          }}
          className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-2 text-sm font-bold text-tm-navy"
        />
      </label>
    </div>
  )
}
