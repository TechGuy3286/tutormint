import Link from 'next/link'
import type { ReactNode } from 'react'

import { TILE_TONE, type TileTone } from '@/lib/tileTones'

// One square dashboard tile — the shared shape behind BOTH the "Your things"
// grid and the Activity band, so the two dashboards cannot drift into two card
// languages again.
//
// The form is a financial-app category tile: a light card, a coloured icon
// centred in a soft chip at the top, and a short label centred beneath it. The
// icon leads; a count, when there is one, sits under the chip but is quieter
// than it. Roughly square rather than wide, two to a row on a phone.
//
// It is presentational and has no hooks, so a server component (YourThings) and
// a formerly-client one (ActivityCard) can both render it. The whole tile is a
// link — there is no second tap target inside it, which is what lets it stay a
// clean square at 360px where a button row would wrap.

export type { TileTone }

export default function StatTile({
  href,
  prefetch,
  tone,
  icon,
  value,
  label,
  note,
  tip,
  unread = false,
  highlight = false,
}: {
  href: string
  prefetch?: boolean
  tone: TileTone
  /** An icon element — rendered inside the chip; pass it sized ~22px. */
  icon: ReactNode
  /** The count or word ("2", "Unlimited", "—"). Omit for a label-only tile. */
  value?: ReactNode
  /** The short centred label. Clamped to two lines. */
  label: string
  /** A quieter line under the label — a qualifier ("open") or a timestamp. */
  note?: ReactNode
  /** Desktop-only hover tooltip (PR27 §2), e.g. "Tutors interested in your tuitions". */
  tip?: string
  /** Draws the red unread dot in the top-right corner. */
  unread?: boolean
  /** Something with a consequence (a plan ending, a genuinely new thing): the
   *  card takes a red border so the eye lands on it, whatever its tone. */
  highlight?: boolean
}) {
  const t = TILE_TONE[tone]
  return (
    <li>
      <Link
        prefetch={prefetch}
        href={href}
        data-tip={tip}
        className={`relative flex h-full min-h-[9.5rem] flex-col items-center justify-center gap-2 rounded-2xl border bg-white p-4 text-center transition-shadow hover:shadow-md ${
          highlight
            ? 'border-tm-red shadow-[0_2px_14px_-6px_var(--color-tm-red)]'
            : 'border-gray-200 shadow-xs'
        }`}
      >
        {unread && (
          <span
            aria-hidden
            className="absolute right-3 top-3 h-2 w-2 rounded-full bg-tm-red"
          />
        )}

        <span className={`grid h-12 w-12 place-items-center rounded-2xl ${t.chip}`}>{icon}</span>

        {value != null && (
          <span className={`text-xl font-black leading-none ${t.ink}`}>{value}</span>
        )}

        <span className="line-clamp-2 text-xs font-semibold leading-snug text-gray-700">
          {label}
        </span>

        {note && <span className="text-[11px] leading-tight text-gray-500">{note}</span>}
      </Link>
    </li>
  )
}
