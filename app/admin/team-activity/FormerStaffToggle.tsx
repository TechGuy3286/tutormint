'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// Team activity → Tuitions posted (owner, 27 Oct 2026): every former staff
// member is folded into ONE "Former staff" row; tapping it shows each of them.
// A <details> element cannot sit inside a <tbody>, so this is a small toggle.
export default function FormerStaffToggle({ summary, count, children }: { summary: ReactNode; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <>
      <tr className="bg-gray-50 text-slate-800">
        <td className="px-3 py-2 font-bold">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-[28px] items-center gap-1 text-tm-navy hover:text-tm-red"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            Former staff <span className="font-normal text-gray-500">({count})</span>
          </button>
        </td>
        {summary}
      </tr>
      {open && children}
    </>
  )
}
