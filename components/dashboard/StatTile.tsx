import Link from 'next/link'
import type { ReactNode } from 'react'

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

export type TileTone = 'navy' | 'green' | 'red' | 'gold' | 'mint'

// chip = the tint ground + the family ink for the icon; every pair here is in
// scripts/contrast-check.ts (the tint-chip rows). ink = the same family ink,
// used for the count on the WHITE card. The mint tone uses navy ink — mint's
// own family ink (green-deep) is marginal on the most saturated tint, and navy
// clears AA on both the chip and white.
const TONE: Record<TileTone, { chip: string; ink: string }> = {
  navy: { chip: 'bg-tm-tint-navy text-tm-navy', ink: 'text-tm-navy' },
  green: { chip: 'bg-tm-tint-green text-tm-green-deep', ink: 'text-tm-green-deep' },
  red: { chip: 'bg-tm-tint-red text-tm-red', ink: 'text-tm-red' },
  gold: { chip: 'bg-tm-tint-gold text-tm-gold-ink', ink: 'text-tm-gold-ink' },
  mint: { chip: 'bg-tm-tint-mint text-tm-navy', ink: 'text-tm-navy' },
}

export default function StatTile({
  href,
  prefetch,
  tone,
  icon,
  value,
  label,
  note,
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
  /** Draws the red unread dot in the top-right corner. */
  unread?: boolean
  /** Something with a consequence (a plan ending, a genuinely new thing): the
   *  card takes a red border so the eye lands on it, whatever its tone. */
  highlight?: boolean
}) {
  const t = TONE[tone]
  return (
    <li>
      <Link
        prefetch={prefetch}
        href={href}
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
