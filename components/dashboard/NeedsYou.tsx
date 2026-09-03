import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

import type { NeedRow } from '@/lib/needsYou'

// The first band on both dashboards: what is blocked on this person.
//
// ONE LINE, ONE ACTION. The rows are visually flat and identical to each
// other on purpose. The old dashboards distinguished notices by giving each
// its own card, heading, icon and paragraph, which made the page look like it
// contained six important things when it contained one -- and the one that
// mattered was not necessarily the biggest.
//
// The empty state is not decoration. A band that disappears when it is empty
// teaches the reader nothing, and on the next visit they cannot tell "nothing
// is pending" from "the band failed to load". Saying so plainly, in the same
// place, every time, is what makes the band worth glancing at.

export default function NeedsYou({
  rows,
  emptyHint,
}: {
  rows: NeedRow[]
  /** Role-specific: what this member should know when nothing is pending. */
  emptyHint: string
}) {
  return (
    <section aria-labelledby="needs-you" className="space-y-2">
      <h2
        id="needs-you"
        className="text-[11px] font-black uppercase tracking-wider text-gray-500"
      >
        Needs you
      </h2>

      {rows.length === 0 ? (
        <p className="flex items-start gap-2 rounded-2xl border border-tm-green-deep/20 bg-tm-tint-green p-4 text-xs font-semibold leading-relaxed text-tm-green-deep">
          <CheckCircle2 aria-hidden size={16} className="mt-px shrink-0" />
          Nothing needs you right now. {emptyHint}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {rows.map((r) => {
            const Icon = r.tone === 'urgent' ? AlertTriangle : Clock
            return (
              <li
                key={r.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <Icon
                    aria-hidden
                    size={16}
                    className={`mt-0.5 shrink-0 ${
                      r.tone === 'urgent' ? 'text-tm-red' : 'text-tm-gold-ink'
                    }`}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-black text-tm-navy">{r.title}</p>
                    <p className="text-[11px] leading-relaxed text-gray-500">{r.why}</p>
                  </div>
                </div>
                {/* The single action. A second link here would make the reader
                    choose before they can act. */}
                <Link
                  href={r.action.href}
                  className={`inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl px-4 text-xs font-bold transition-colors ${
                    r.tone === 'urgent'
                      ? 'bg-tm-red text-white hover:bg-tm-red-hover'
                      : 'border border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                  }`}
                >
                  {r.action.label}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
