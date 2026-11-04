import Link from 'next/link'
import { CheckCircle2, ArrowRight } from 'lucide-react'

import { completionLine } from '@/lib/profileRequired'

// The one plain completion line (owner, 4 Nov 2026), on the tutor and parent
// dashboards and the top of Edit Profile:
//   "93% — add your availability to reach 100%"   + a button per missing item
//   "100% — your profile is complete" ✓
// The numbers and items come from the shared rule (lib/profileRequired). No
// hooks, so it renders on the server (dashboards) and in client pages alike.
// A button opens the card that fixes the item: a link from the dashboard, or —
// on Edit Profile — `onOpen(card)` so the card opens in place.

export type CompletionLineItem = {
  key: string
  label: string
  button: string
  /** Where the button goes (the Edit Profile card, or the step that fixes it). */
  href: string
  /** The Edit Profile card key, when the page can open it in place. */
  card?: string | null
}

export default function CompletionLine({
  percent,
  missing,
  onOpen,
}: {
  percent: number
  missing: CompletionLineItem[]
  onOpen?: (card: string) => void
}) {
  const complete = missing.length === 0 || percent >= 100
  const line = completionLine(percent, missing)

  if (complete) {
    return (
      <p
        data-testid="completion-line"
        className="flex items-center gap-2 rounded-2xl border border-tm-green-deep/20 bg-tm-tint-green px-4 py-3 text-sm font-bold text-tm-green-deep"
      >
        <CheckCircle2 aria-hidden size={18} className="shrink-0" />
        {line}
      </p>
    )
  }

  const BTN =
    'inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-tm-red bg-white px-3 text-xs font-bold text-tm-red hover:bg-tm-tint-red'
  return (
    <section data-testid="completion-line" className="space-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-sm font-bold text-tm-navy">{line}</p>
      <div className="flex flex-wrap gap-2">
        {missing.map((m) =>
          onOpen && m.card ? (
            <button key={m.key} type="button" onClick={() => onOpen(m.card as string)} className={BTN}>
              {m.button} <ArrowRight aria-hidden size={12} />
            </button>
          ) : (
            <Link key={m.key} href={m.href} className={BTN}>
              {m.button} <ArrowRight aria-hidden size={12} />
            </Link>
          ),
        )}
      </div>
    </section>
  )
}
