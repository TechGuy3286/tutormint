'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'

// One row of card actions, at every width.
//
// The rule (CLAUDE.md, mobile polish): every card shows ONE row of icon+label
// buttons; if there are more than three actions, the primary ones stay visible
// and the rest fold into a "More" menu. No button wraps to a second row, and no
// action is reduced to an icon alone — labels always stay.
//
// So the collapsed state is always a single non-wrapping flex row. When there
// are more actions than fit, a "More" button opens a small menu (the same
// open/close/Escape/outside-click pattern the header menu uses) holding the
// rest — an overlay, not a second row.

export type CardAction = {
  key: string
  label: string
  icon: React.ReactNode
  /** Full button classes (colour/border). Kept per-action so a card controls its own palette. */
  className: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  ariaPressed?: boolean
}

const BTN =
  'inline-flex min-h-[44px] flex-1 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-bold transition-colors disabled:opacity-60'

function ActionButton({ a }: { a: CardAction }) {
  const content = (
    <>
      {a.icon}
      <span className="truncate">{a.label}</span>
    </>
  )
  if (a.href) {
    return (
      <Link href={a.href} className={`${BTN} ${a.className}`}>
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={a.onClick}
      disabled={a.disabled}
      aria-pressed={a.ariaPressed}
      className={`${BTN} ${a.className}`}
    >
      {content}
    </button>
  )
}

export default function CardActions({
  actions,
  maxVisible = 3,
}: {
  actions: CardAction[]
  /** Slots in the row, including the More button when it appears. */
  maxVisible?: number
}) {
  const overflow = actions.length > maxVisible
  const visible = overflow ? actions.slice(0, maxVisible - 1) : actions
  const hidden = overflow ? actions.slice(maxVisible - 1) : []

  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative z-10 flex items-stretch gap-2">
      {visible.map((a) => (
        <ActionButton key={a.key} a={a} />
      ))}

      {overflow && (
        <div ref={boxRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="More actions"
            className={`${BTN} flex-none border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}
          >
            <MoreHorizontal aria-hidden size={14} />
            <span className="truncate">More</span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            >
              {hidden.map((a) =>
                a.href ? (
                  <Link
                    key={a.key}
                    href={a.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex min-h-[44px] items-center gap-2 px-3 text-xs font-bold text-tm-navy hover:bg-tm-bg"
                  >
                    {a.icon}
                    {a.label}
                  </Link>
                ) : (
                  <button
                    key={a.key}
                    type="button"
                    role="menuitem"
                    disabled={a.disabled}
                    aria-pressed={a.ariaPressed}
                    onClick={() => {
                      setOpen(false)
                      a.onClick?.()
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-xs font-bold text-tm-navy hover:bg-tm-bg disabled:opacity-60"
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
