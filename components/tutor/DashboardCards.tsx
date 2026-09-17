import Link from 'next/link'
import { Briefcase } from 'lucide-react'

import StatTile from '@/components/dashboard/StatTile'
import OnlineSuitableChip from '@/components/OnlineSuitableChip'
import type { WeekJob } from '@/lib/funnel'
import ApplyFromStrip from '@/app/(site)/tutor/dashboard/ApplyFromStrip'

// The tutor dashboard's cards (PR19 §3). Each is a bordered white card with its
// own plain-English title inside — no loose text on the page. Phone-first: the
// whole page is one narrow column, and the count tiles are a fixed two-column
// grid.

const CARD = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4'
const TITLE = 'flex items-center gap-2 text-sm font-black text-tm-navy'

/** §3.2 — the small count tiles, two to a row, each tappable. */
export type CountTile = {
  key: string
  icon: React.ReactNode
  value: number
  label: string
  href: string
  tone: 'navy' | 'green' | 'red' | 'gold' | 'mint'
  highlight?: boolean
}

export function CountGrid({ tiles }: { tiles: CountTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <StatTile
          key={t.key}
          href={t.href}
          prefetch={false}
          tone={t.highlight ? 'red' : t.tone}
          highlight={t.highlight}
          icon={t.icon}
          value={t.value}
          label={t.label}
        />
      ))}
    </ul>
  )
}

/** §3.3 — the matching tuitions and its empty state. */
export function TuitionsForYouCard({ jobs, canApply }: { jobs: WeekJob[]; canApply: boolean }) {
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <Briefcase aria-hidden size={16} className="text-gray-500" />
        Tuitions for you
      </h2>
      {jobs.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          No new tuitions match your subjects and city yet.{' '}
          <Link href="/tutor/dashboard/jobs" className="font-bold text-tm-red hover:underline">
            See all open tuitions
          </Link>
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {jobs.slice(0, 5).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Link href="/tutor/dashboard/jobs" className="block truncate text-[11px] font-bold text-tm-navy hover:underline">
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
          <Link href="/tutor/dashboard/jobs" className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-red hover:underline">
            See all open tuitions
          </Link>
        </>
      )}
    </section>
  )
}
