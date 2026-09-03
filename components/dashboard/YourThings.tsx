import Link from 'next/link'
import {
  Briefcase,
  CreditCard,
  Eye,
  FilePlus2,
  MessageSquare,
  Send,
  Users,
  UserRound,
  Video,
} from 'lucide-react'

// The third band: everything the member owns, as counts that link out.
//
// THE LISTS THEMSELVES LIVE ON THEIR OWN PAGES. That is the whole point. The
// parent dashboard this replaced rendered all nine of a parent's tuitions
// inline, then every demo, then every child -- 2,428px on a laptop, most of it
// content the member had already seen and none of it summarised. A count
// answers "is there anything new here" in one glance; the list answers "what
// exactly", which is a different question and deserves its own page.
//
// A row with a zero count still renders, greyed and still a link. Hiding it
// would mean the page silently changes shape between visits, and a member
// looking for "hired tutors" would find the row missing rather than empty.

export type ThingRow = {
  key: string
  label: string
  /** The number shown. `null` renders an em dash — unknown, not zero. */
  count: number | null
  /** Short qualifier: "open", "unread", "awaiting you". */
  note?: string
  href: string
  icon:
    | 'jobs'
    | 'applications'
    | 'messages'
    | 'hired'
    | 'demos'
    | 'children'
    | 'views'
    | 'plan'
    | 'video'
  /** Draws attention without shouting — used for genuinely new things. */
  highlight?: boolean
}

const ICONS = {
  jobs: FilePlus2,
  applications: Send,
  messages: MessageSquare,
  hired: Users,
  demos: Video,
  children: UserRound,
  views: Eye,
  plan: CreditCard,
  video: Briefcase,
} as const

export default function YourThings({ rows }: { rows: ThingRow[] }) {
  return (
    <section aria-labelledby="your-things" className="space-y-2">
      <h2
        id="your-things"
        className="text-[11px] font-black uppercase tracking-wider text-gray-500"
      >
        Your things
      </h2>

      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const Icon = ICONS[r.icon]
          const empty = r.count === 0
          return (
            <li key={r.key}>
              <Link
                href={r.href}
                className={`flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 transition-colors ${
                  r.highlight
                    ? 'border-tm-red/30 hover:border-tm-red'
                    : 'border-gray-200 hover:border-tm-navy'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  {/* Icons stay at the 500 weight even on an empty row. The
                      lighter grey below it is 2.54:1 on white, fails AA at any
                      size, and check:contrast rejects it on sight. */}
                  <Icon aria-hidden size={15} className="shrink-0 text-gray-500" />
                  <span className="truncate text-xs font-bold text-tm-navy">{r.label}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span
                    className={`text-sm font-black ${
                      empty ? 'text-gray-500' : 'text-tm-navy'
                    }`}
                  >
                    {r.count === null ? '—' : r.count}
                  </span>
                  {r.note && (
                    <span className="text-[10px] font-semibold text-gray-500">{r.note}</span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
