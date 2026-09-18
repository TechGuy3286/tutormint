'use client'

import Link from 'next/link'

// Card actions, laid out as a two-column grid at every width (PR25 §3).
//
// The rule the owner set: every visible action shows, no hidden "More" menu.
// Four actions read as two rows of two on a 360px phone, full width, with large
// tap targets; on a wider card the same 2×2 grid stays centred rather than
// stretching into one long row. A card with two actions (a tuition card) is one
// row of two; three is two rows (2 + 1). No button wraps mid-label — labels
// always stay.

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
  'inline-flex min-h-[44px] w-full min-w-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-bold transition-colors disabled:opacity-60'

function ActionButton({ a }: { a: CardAction }) {
  const content = (
    <>
      {a.icon}
      <span className="truncate">{a.label}</span>
    </>
  )
  if (a.href) {
    return (
      <Link prefetch={false} href={a.href} className={`${BTN} ${a.className}`}>
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

export default function CardActions({ actions }: { actions: CardAction[] }) {
  return (
    <div className="relative z-10 grid grid-cols-2 gap-2">
      {actions.map((a) => (
        <ActionButton key={a.key} a={a} />
      ))}
    </div>
  )
}
