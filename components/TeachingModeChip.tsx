import { Users, Wifi, MonitorSmartphone } from 'lucide-react'
import { teachingMode } from '@/lib/display'

// How a tutor teaches — in person, online, or both — as one consistent chip.
//
// Mode used to be buried: on the card it was only the Area line's fallback
// (invisible whenever a tutor had an area), and on the profile a "· In person
// or online" tail on the city line. A parent could not tell at a glance whether
// a tutor comes to the house or teaches over a screen. This is the single
// treatment used on every display surface (card, profile), so the icon and the
// words never drift; the browse and search filters use the SAME vocabulary
// through the same `teachingMode()` helper. Presentational, no hooks, so a
// server component can render it.

const ICON = {
  in_person: Users,
  online: Wifi,
  both: MonitorSmartphone,
} as const

/** Resolve the stored value to its icon, tolerating the retired spellings the
 *  display helper also accepts ('Physical' / 'Online' / 'Both'). */
function iconFor(mode: string | null | undefined) {
  const k = (mode ?? '').toLowerCase()
  if (k === 'in_person' || k === 'physical') return ICON.in_person
  if (k === 'online') return ICON.online
  return ICON.both // 'both', anything unrecognised, and the default all read "or"
}

export default function TeachingModeChip({
  mode,
  className = '',
}: {
  mode: string | null | undefined
  className?: string
}) {
  const label = teachingMode(mode)
  if (!label) return null
  const Icon = iconFor(mode)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-tm-tint-navy px-2.5 py-1 text-[11px] font-bold text-tm-navy ${className}`}
    >
      <Icon size={13} aria-hidden />
      {label}
    </span>
  )
}
