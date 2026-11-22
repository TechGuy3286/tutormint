'use client'

import { useState } from 'react'

// A row of chips that shows the first few and a "+N more" chip which opens the
// rest in place (PR-15: a tutor's job titles, first 5). No page jump, no
// pop-up; the button is a real 44 px tap target.

export default function ExpandableChips({
  items,
  max = 5,
  chipClassName = 'inline-flex items-center rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy',
  className = '',
}: {
  items: readonly string[]
  max?: number
  chipClassName?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const list = [...new Set(items.filter(Boolean))]
  if (list.length === 0) return null
  const shown = open ? list : list.slice(0, max)
  const more = list.length - max
  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${className}`} data-expandable-chips="">
      {shown.map((t) => (
        <li key={t} className={chipClassName}>
          {t}
        </li>
      ))}
      {!open && more > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={false}
            className="-my-2 inline-flex min-h-[44px] items-center px-1 text-[11px] font-bold text-tm-red hover:underline"
          >
            +{more} more
          </button>
        </li>
      )}
    </ul>
  )
}
