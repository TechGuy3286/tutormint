'use client'

import {
  ChevronDown,
  CreditCard,
  MessageSquare,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { FAMILY_STYLE, familyFor, groupedLabel } from '@/lib/activityFamily'
import type { FeedGroup } from '@/lib/feedGrouping'
import { formatDateTime, relativeTime } from '@/lib/datetime'

// One card in the ACTIVITY grid.
//
// The band this replaced was a flat bordered list of one-line rows and read
// like a log file: the same weight, the same colour and the same shape for
// "you were hired" and "you shortlisted a tutor". A card with a coloured disc
// lets somebody find the money row or the moderation row without reading every
// line -- the colour is a scanning aid, and it never carries meaning the words
// do not also carry.
//
// GROUPING IS EXPANDABLE, NEVER LOSSY. Four plan changes on one day collapse
// into "Your plan changed 4 times", and pressing it lists all four with their
// own times and links. The count is `items.length`, so the number on the card
// and the number of rows behind it cannot disagree.

const ICONS = {
  message: MessageSquare,
  money: CreditCard,
  progress: Sparkles,
  shield: ShieldAlert,
} as const

export default function ActivityCard({ group }: { group: FeedGroup }) {
  const [open, setOpen] = useState(false)
  const family = familyFor(group.type)
  const style = FAMILY_STYLE[family]
  const Icon = ICONS[style.icon]

  const grouped = group.count > 1
  const title = grouped
    ? groupedLabel(group.type, group.count, group.head.text)
    : group.head.text

  const body = (
    <span className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.className}`}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-start gap-1.5">
          {group.unread && (
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tm-red" />
          )}
          <span
            className={`block text-xs leading-snug ${
              group.unread ? 'font-black' : 'font-semibold'
            } text-tm-navy`}
          >
            {title}
          </span>
        </span>
        <span className="block text-[11px] text-gray-500" title={formatDateTime(group.head.at)}>
          {relativeTime(group.head.at)}
        </span>
      </span>
    </span>
  )

  return (
    <li className="rounded-2xl border border-gray-200 bg-white shadow-xs transition-shadow hover:shadow-md">
      {grouped ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 p-3 text-left"
          >
            {body}
            <ChevronDown
              aria-hidden
              size={15}
              className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <ul className="space-y-0.5 border-t border-gray-100 px-3 pb-2 pt-2">
              {/* EVERY row in the run, not a sample. */}
              {group.items.map((item) => {
                const line = (
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-700">
                      {item.text}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {relativeTime(item.at)}
                    </span>
                  </span>
                )
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="flex min-h-[44px] items-center rounded-lg px-2 transition-colors hover:bg-tm-bg"
                      >
                        {line}
                      </Link>
                    ) : (
                      <span className="flex min-h-[44px] items-center px-2">{line}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : group.head.href ? (
        <Link href={group.head.href} className="flex min-h-[44px] items-center p-3">
          {body}
        </Link>
      ) : (
        // Not every event has an honest destination; the card still renders.
        <div className="flex min-h-[44px] items-center p-3">{body}</div>
      )}
    </li>
  )
}
