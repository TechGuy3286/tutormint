import StatTile from '@/components/dashboard/StatTile'

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
