import StatTile from '@/components/dashboard/StatTile'
import type { TileTone } from '@/lib/tileTones'

// The tutor dashboard's count tiles (PR20 §3.2) — a fixed two-column grid of
// compact, tappable icon + number + label tiles. Phone-first: two to a row at
// every width.

/** A single count tile. */
export type CountTile = {
  key: string
  icon: React.ReactNode
  value: number
  label: string
  href: string
  tone: TileTone
  highlight?: boolean
  /** Desktop-only hover tooltip (PR27 §2). */
  tip?: string
}

export function CountGrid({ tiles }: { tiles: CountTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        // The tile KEEPS its own distinct tone even when highlighted (PR32 §2):
        // every tile is a different colour and no two share, so highlight no
        // longer repaints it red. The attention cue is the red border StatTile
        // draws from `highlight`, which stands out whatever the tile's colour.
        <StatTile
          key={t.key}
          href={t.href}
          prefetch={false}
          tone={t.tone}
          highlight={t.highlight}
          icon={t.icon}
          value={t.value}
          label={t.label}
          tip={t.tip}
        />
      ))}
    </ul>
  )
}
