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

import StatTile, { type TileTone } from '@/components/dashboard/StatTile'

// The third band: everything the member owns, as counts that link out.
//
// THE LISTS THEMSELVES LIVE ON THEIR OWN PAGES. That is the whole point. The
// parent dashboard this replaced rendered all nine of a parent's tuitions
// inline, then every demo, then every child -- 2,428px on a laptop, most of it
// content the member had already seen and none of it summarised. A count
// answers "is there anything new here" in one glance; the list answers "what
// exactly", which is a different question and deserves its own page.
//
// Rendered as square category tiles (components/dashboard/StatTile) — the same
// shape the Activity band uses, so the two dashboards share one card language.
// A row with a zero count still renders: hiding it would mean the page silently
// changes shape between visits, and a member looking for "hired tutors" would
// find the row missing rather than empty.

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

// Tone by concept (keyed on the icon, shared with the Activity band's families
// so the same kind of thing wears the same colour on both, and adjacent tiles
// differ). A highlighted tile (something genuinely new) always goes red, so the
// eye lands on it — handled by StatTile's `highlight`.
const TILE_TONE: Record<keyof typeof ICONS, TileTone> = {
  jobs: 'gold',
  applications: 'green',
  messages: 'navy',
  hired: 'green',
  demos: 'red',
  children: 'mint',
  views: 'mint',
  plan: 'navy',
  video: 'gold',
}

export default function YourThings({ rows }: { rows: ThingRow[] }) {
  return (
    <section aria-labelledby="your-things" className="space-y-3">
      <h2
        id="your-things"
        className="text-[11px] font-black uppercase tracking-wider text-gray-500"
      >
        Your things
      </h2>

      {/* Square tiles: the icon leads, the count sits under it, the label names
          it. Two to a row on a phone, up to four on a laptop. */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => {
          const Icon = ICONS[r.icon]
          // A word ("Unlimited") wins over the number; then a real number; then
          // an em dash for "unknown". Zero is a real value and is shown.
          const value = r.display ?? (r.count === null ? '—' : r.count)
          return (
            <StatTile
              key={r.key}
              href={r.href}
              prefetch={false}
              tone={r.highlight ? 'red' : TILE_TONE[r.icon]}
              highlight={r.highlight}
              icon={<Icon aria-hidden size={22} />}
              value={value}
              label={r.label}
              note={r.note}
            />
          )
        })}
      </ul>
    </section>
  )
}
