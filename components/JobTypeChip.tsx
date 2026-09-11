import { Home, Wifi, Briefcase } from 'lucide-react'
import { jobType } from '@/lib/display'
import { isOnlineTitle } from '@/lib/jobTitlesCore'

// A tutor's (or a tuition's) Job Type — one of the 19 job titles (migration 77) —
// as one consistent chip.
//
// This is the single treatment used on every display surface (card, profile), so
// the icon and the words never drift; browse and search filters use the SAME
// vocabulary through the same `jobType()` helper. Presentational, no hooks, so a
// server component can render it.
//
// With 19 titles a per-title icon is more noise than signal, so the icon marks
// the one distinction that changes behaviour: "Online Tutor" (city-agnostic) gets
// the wifi mark, "Home Tutor" the house, and every other title a neutral
// briefcase.
function iconFor(mode: string | null | undefined) {
  const k = (mode ?? '').trim().toLowerCase()
  if (isOnlineTitle(mode) || k === 'online' || k === 'remote') return Wifi
  if (k === 'home tutor' || k === 'home' || k === 'in_person' || k === 'both' || k === 'physical') return Home
  return Briefcase
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
