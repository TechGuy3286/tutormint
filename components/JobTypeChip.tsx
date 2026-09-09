import { Home, Wifi, School } from 'lucide-react'
import { jobType } from '@/lib/display'

// A tutor's (or a tuition's) Job Type — Home Tuition, Online Tuition or School
// Job — as one consistent chip.
//
// Job Type used to be buried: on the card it was only the Area line's fallback
// (invisible whenever a tutor had an area), on the profile a small tail on the
// city line. This is the single treatment used on every display surface (card,
// profile), so the icon and the words never drift; browse and search filters
// use the SAME vocabulary through the same `jobType()` helper. Presentational,
// no hooks, so a server component can render it.

const ICON = {
  home: Home,
  online: Wifi,
  school: School,
} as const

/** Resolve the stored value to its icon, tolerating the retired spellings the
 *  display helper also accepts (in_person / both / physical → home). */
function iconFor(mode: string | null | undefined) {
  const k = (mode ?? '').toLowerCase()
  if (k === 'online' || k === 'remote') return ICON.online
  if (k === 'school' || k === 'school_job') return ICON.school
  return ICON.home // home, and every retired in-person / both spelling
}

export default function JobTypeChip({
  mode,
  className = '',
}: {
  mode: string | null | undefined
  className?: string
}) {
  const label = jobType(mode)
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
