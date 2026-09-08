import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Clock, Plus } from 'lucide-react'

import DismissNeed from '@/components/dashboard/DismissNeed'
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
  blockedEmpty,
}: {
  rows: NeedRow[]
  /** Role-specific: what this member should know when nothing is pending. */
  emptyHint: string
  /**
   * When there are no rows but the member is NOT genuinely clear — e.g. a tutor
   * who is not listed because their profile is incomplete — the green "nothing
   * needs you" line would be a lie. In that case this honest amber state renders
   * instead: it never claims they are clear, and points at the thing that is
   * actually holding them back. `emptyHint` (and its "Nothing needs you" framing)
   * is used ONLY when this is absent.
   */
  blockedEmpty?: { title: string; hint: string; action?: { label: string; href: string } }
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
        blockedEmpty ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0 text-tm-gold-ink" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-black text-tm-gold-ink">{blockedEmpty.title}</p>
                <p className="text-[11px] font-semibold leading-relaxed text-tm-gold-ink">{blockedEmpty.hint}</p>
              </div>
            </div>
            {blockedEmpty.action && (
              <Link
                href={blockedEmpty.action.href}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
              >
                <ArrowRight aria-hidden size={13} />
                {blockedEmpty.action.label}
              </Link>
            )}
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-2xl border border-tm-green-deep/20 bg-tm-tint-green p-4 text-xs font-semibold leading-relaxed text-tm-green-deep">
            <CheckCircle2 aria-hidden size={16} className="mt-px shrink-0" />
            Nothing needs you right now. {emptyHint}
          </p>
        )
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {rows.map((r) => {
            const Icon = r.tone === 'urgent' ? AlertTriangle : Clock
            return (
              <li key={r.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
                <div className="flex shrink-0 items-center gap-1">
                  {/* The single action. A second LINK here would make the
                      reader choose before they can act; the dismiss beside it
                      is not a second destination, it is the way to stop being
                      told. Only the lapsed-plan row carries one. */}
                  <Link
                    href={r.action.href}
                    className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-colors ${
                      r.tone === 'urgent'
                        ? 'bg-tm-red text-white hover:bg-tm-red-hover'
                        : 'border border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
                    }`}
                  >
                    <ArrowRight aria-hidden size={13} />
                    {r.action.label}
                  </Link>
                  {r.dismissSubscriptionId && (
                    <DismissNeed subscriptionId={r.dismissSubscriptionId} />
                  )}
                </div>
                </div>

                {/* The itemised checklist: what is done, what is not. A
                    percentage is not an instruction — this is. Each incomplete
                    item is a direct link to the step that fixes it; done items
                    are shown ticked so progress is visible. */}
                {r.checklist && r.checklist.length > 0 && (
                  <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {r.checklist.map((c) =>
                      c.done ? (
                        <li
                          key={c.key}
                          className="flex items-center gap-2 rounded-lg bg-tm-tint-green px-2.5 py-2 text-[11px] font-semibold text-tm-green-deep"
                        >
                          <Check aria-hidden size={13} className="shrink-0" />
                          <span className="min-w-0 truncate">{c.label}</span>
                        </li>
                      ) : (
                        <li key={c.key}>
                          <Link
                            href={c.href}
                            className="flex min-h-[40px] items-center justify-between gap-2 rounded-lg border border-gray-200 bg-tm-bg px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition-colors hover:border-tm-red hover:bg-white"
                          >
                            <span className="min-w-0 truncate">{c.label}</span>
                            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-tm-red">
                              <Plus aria-hidden size={11} />
                              Add
                            </span>
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
