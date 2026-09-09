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
  /** Overrides `count` with a word — the "Unlimited" plan allowance, where a
   *  number would surface the real 100-cap the plan advertises away. */
  display?: string
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
    <section aria-labelledby="your-things" className="space-y-3">
      <h2
        id="your-things"
        className="text-[11px] font-black uppercase tracking-wider text-gray-500"
      >
        Your things
      </h2>

      {/* Stat tiles: a larger icon in a tinted chip, the number as the loud
          element, its label quiet beneath it. Two columns on a phone, three on
          a tablet up — each tile is its own card with real separation, not a row
          in a cramped list. */}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {rows.map((r) => {
          const Icon = ICONS[r.icon]
          // A word ("Unlimited") wins over the number; then a real number; then
          // an em dash for "unknown". Zero is a real value, shown, but dimmed.
          const hasValue = r.display != null || (r.count !== null && r.count !== 0)
          const value = r.display ?? (r.count === null ? '—' : r.count)
          const isWord = r.display != null
          return (
            <li key={r.key}>
              <Link
                prefetch={false}
                href={r.href}
                className={`flex h-full flex-col justify-between gap-4 rounded-2xl border bg-white p-4 transition-colors ${
                  r.highlight
                    ? 'border-tm-red/40 hover:border-tm-red'
                    : 'border-gray-200 hover:border-tm-navy'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tm-tint-navy">
                    <Icon aria-hidden size={20} className="text-tm-navy" />
                  </span>
                  {r.note && (
                    <span className="truncate rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                      {r.note}
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-1">
                  <span
                    className={`font-bold leading-none ${isWord ? 'text-2xl' : 'text-3xl'} ${
                      hasValue ? (r.highlight ? 'text-tm-red' : 'text-tm-navy') : 'text-gray-500'
                    }`}
                  >
                    {value}
                  </span>
                  <span className="text-sm leading-snug text-gray-600">{r.label}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
