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
  badge,
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
  /** A small red count badge in the top-right corner (e.g. unread messages). No
   *  badge when 0 or undefined; caps the display at 99+ (PR44 §2). */
  badge?: number
  /** Draws the red unread dot in the top-right corner. */
  unread?: boolean
  /** Something with a consequence (a plan ending, a genuinely new thing): the
   *  card takes a red border so the eye lands on it, whatever its tone. */
  highlight?: boolean
}) {
  const t = TILE_TONE[tone]
  return (
    <li>
      {/* The WHOLE box is washed in the tone's soft tint (PR34 §2); the border
          stays for definition and the red highlight border still wins. */}
      <Link
        prefetch={prefetch}
        href={href}
        data-tip={tip}
        className={`relative flex h-full min-h-[9.5rem] flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center transition-shadow hover:shadow-md ${t.card} ${
          highlight
            ? 'border-tm-red shadow-[0_2px_14px_-6px_var(--color-tm-red)]'
            : 'border-black/5 shadow-xs'
        }`}
      >
        {/* Unread count badge — the small red pill in the corner (PR44 §2). The
            unread number lives HERE, never as the tile's main value; the same
            red as the header bell and the inbox pill, on both dashboards. */}
        {typeof badge === 'number' && badge > 0 && (
          <span
            className="absolute right-2.5 top-2.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-tm-red px-1.5 text-[10px] font-black text-white"
            aria-label={`${badge} unread`}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}

        {unread && badge == null && (
          <span
            aria-hidden
            className="absolute right-3 top-3 h-2 w-2 rounded-full bg-tm-red"
          />
        )}

        {/* The icon disc: a solid brand hue with a white glyph, so it reads on
            both the light and the dark box. */}
        <span className={`grid h-12 w-12 place-items-center rounded-2xl ${t.chip}`}>{icon}</span>

        {/* Number, label and helper all take the tone's dark ink shade. */}
        {value != null && (
          <span className={`text-xl font-black leading-none ${t.ink}`}>{value}</span>
        )}

        <span className={`line-clamp-2 text-xs font-semibold leading-snug ${t.ink}`}>
          {label}
        </span>

        {note && <span className={`text-[11px] leading-tight opacity-80 ${t.ink}`}>{note}</span>}
      </Link>
    </li>
  )
}
