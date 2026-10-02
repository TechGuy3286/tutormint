import { formatDateTime } from '@/lib/datetime'
import { timelineSentence } from '@/lib/timelineText'
import type { TimelineRowData } from '@/lib/adminQueues'

// One row of a member's timeline, rendered identically whether the server drew
// it or the browser appended it. Same reason MemberRow exists: two renderings
// of one row is how a list develops a visible seam at the page boundary.
//
// PLAIN ENGLISH ONLY (PR100 §3): the row is a single sentence from
// lib/timelineText — never `key: value`, an internal code or JSON. A collapsed
// run of subject edits arrives as one row (lib/timelineText collapseTimeline)
// and reads as one line. Message events still carry only a thread reference in
// meta, and lib/activityLog never puts a body there — there is nothing to leak.

export type TimelineEvent = TimelineRowData

// Tone tint by event family — colour is secondary to the sentence, never the
// only signal.
const TONE: Record<string, string> = {
  suspended: 'bg-tm-tint-red text-tm-red',
  banned: 'bg-tm-tint-red text-tm-red',
  warned: 'bg-tm-tint-gold text-tm-gold-ink',
  reported_by: 'bg-tm-tint-gold text-tm-gold-ink',
  unsuspended: 'bg-tm-tint-green text-tm-green-deep',
  plan_purchased: 'bg-tm-tint-green text-tm-green-deep',
  verification_fee_paid: 'bg-tm-tint-green text-tm-green-deep',
  payment_approved: 'bg-tm-tint-green text-tm-green-deep',
  plan_expired: 'bg-slate-100 text-slate-700',
}

export default function TimelineRow({ event: e }: { event: TimelineEvent }) {
  return (
    <li className="flex min-h-[44px] flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl border border-gray-200 bg-white p-3">
      <span
        className={`min-w-0 flex-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          TONE[e.event] ?? 'bg-slate-100 text-slate-700'
        }`}
      >
        {timelineSentence(e.event, e.meta)}
      </span>
      <span className="shrink-0 text-[11px] text-gray-500">{formatDateTime(e.at)}</span>
    </li>
  )
}
