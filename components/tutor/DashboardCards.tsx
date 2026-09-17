import Link from 'next/link'
import { ArrowRight, ListChecks, Briefcase, MessageSquare, FileText, Activity } from 'lucide-react'

import ActivityCard from '@/components/dashboard/ActivityCard'
import OnlineSuitableChip from '@/components/OnlineSuitableChip'
import { groupFeed, type FeedItem } from '@/lib/feedGrouping'
import type { WeekJob } from '@/lib/funnel'
import ApplyFromStrip from '@/app/(site)/tutor/dashboard/ApplyFromStrip'

// The tutor dashboard's self-contained cards (PR17 §1.4). Each is a bordered
// white card with its own plain-English title inside; the page hides any card
// that has nothing to show (§1.5), except "What to do next" when something is
// missing. Mobile-first — the page stacks these in one column and lays them out
// two-up on desktop below the first card.

const CARD = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4'
const TITLE = 'flex items-center gap-2 text-sm font-black text-tm-navy'

/** §1.4 — the things this tutor still needs to do, each a tap. */
export function WhatToDoNextCard({ items }: { items: { key: string; label: string; href: string }[] }) {
  if (items.length === 0) return null
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <ListChecks aria-hidden size={16} className="text-tm-red" />
        What to do next
      </h2>
      <ul className="space-y-2">
        {items.map((f) => (
          <li key={f.key}>
            <Link
              href={f.href}
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              {f.label}
              <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** §1.4 — tuitions that match this tutor. Hidden when there are none. */
export function TuitionsForYouCard({
  jobs,
  canApply,
}: {
  jobs: WeekJob[]
  canApply: boolean
}) {
  if (jobs.length === 0) return null
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <Briefcase aria-hidden size={16} className="text-gray-500" />
        Tuitions for you
      </h2>
      <ul className="divide-y divide-gray-100">
        {jobs.slice(0, 5).map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <Link
                href="/tutor/dashboard/jobs"
                className="block truncate text-[11px] font-bold text-tm-navy hover:underline"
              >
                {j.title}
              </Link>
              <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <span className="truncate">{[j.area, j.city].filter(Boolean).join(', ') || 'Pakistan'}</span>
                {j.onlineSuitable && <OnlineSuitableChip />}
              </span>
              {j.matchReason && (
                <span className="block truncate text-[10px] font-semibold text-tm-green-deep">{j.matchReason}</span>
              )}
            </span>
            <ApplyFromStrip jobId={j.id} listed={canApply} />
          </li>
        ))}
      </ul>
      <Link
        href="/tutor/dashboard/jobs"
        className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-red hover:underline"
      >
        See all open tuitions
      </Link>
    </section>
  )
}

/** §1.4 — messages and demo requests, as counts that open the right screen. */
export function MessagesDemosCard({
  unread,
  demos,
}: {
  unread: number
  demos: number
}) {
  if (unread === 0 && demos === 0) return null
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <MessageSquare aria-hidden size={16} className="text-gray-500" />
        Messages and demo requests
      </h2>
      <ul className="space-y-2">
        {unread > 0 && (
          <li>
            <Link
              href="/tutor/dashboard/messages"
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              {unread} new message{unread === 1 ? '' : 's'}
              <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
            </Link>
          </li>
        )}
        {demos > 0 && (
          <li>
            <Link
              href="/tutor/dashboard/demos"
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              {demos} demo request{demos === 1 ? '' : 's'}
              <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
            </Link>
          </li>
        )}
      </ul>
    </section>
  )
}

/** §1.4 — how many tuitions this tutor has applied to. Hidden when none. */
export function MyApplicationsCard({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <FileText aria-hidden size={16} className="text-gray-500" />
        My applications
      </h2>
      <Link
        href="/tutor/dashboard/applications"
        className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
      >
        You have applied to {count} tuition{count === 1 ? '' : 's'}
        <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
      </Link>
    </section>
  )
}

/** §1.4 — the last few things that happened. Hidden when the feed is empty. */
export function RecentActivityCard({ items, unreadMessages }: { items: FeedItem[]; unreadMessages: number }) {
  const groups = groupFeed(items, { messages: 'all', inboxHref: '/tutor/dashboard/messages' }).slice(0, 5)
  if (groups.length === 0) return null
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <Activity aria-hidden size={16} className="text-gray-500" />
        Recent activity
      </h2>
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
        {groups.map((g) => (
          <ActivityCard key={g.key} group={g} unreadMessages={unreadMessages} />
        ))}
      </ul>
    </section>
  )
}
