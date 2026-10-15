'use client'

import { useRouter } from 'next/navigation'

// The month selector on Team activity → Paid sign-ups (owner, 16 Oct 2026).
// Choosing a month opens that month's board; a past month shows its own
// targets and results.

export default function MonthPicker({ month, options }: { month: string; options: { key: string; label: string }[] }) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
      Month
      <select
        value={month}
        onChange={(e) => router.push(`/admin/team-activity?month=${encodeURIComponent(e.target.value)}`)}
        className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-tm-navy"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
