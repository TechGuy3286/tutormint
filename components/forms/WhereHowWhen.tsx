'use client'

import type { ReactNode } from 'react'
import { Building2, MapPin, MonitorSmartphone, Wallet, Calendar, Clock } from 'lucide-react'

import { CITIES, TEACHING_MODES } from '@/lib/locations'
import { BUDGET_BANDS } from '@/lib/feeBands'
import { teachingMode } from '@/lib/display'

// The "Where, how and when" row of the job form — the six selects for city,
// area, mode, budget, days and times.
//
// SHARED by the parent post-a-tuition form AND the admin team-post form, so the
// two cannot drift: an icon or a placeholder changed here changes in both. Each
// select carries a recognising icon (location, mode, money, calendar, clock)
// and a short placeholder that is the field's own noun — "City", not "Choose a
// city" — since a visible sr-only label already names it for a screen reader.

export const DAY_OPTIONS = ['Weekdays', 'Weekends', 'Every day'] as const
export const TIME_OPTIONS = ['Mornings', 'Afternoons', 'Evenings'] as const

/** A select with a left-hand recognising icon. The icon accompanies the field's
 *  own text (its placeholder or chosen value) — never icon-only. */
function IconSelect({
  icon,
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  icon: ReactNode
  /** Names the control for assistive tech; the placeholder shows the same word. */
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label className="space-y-1">
      <span className="sr-only">{label}</span>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        >
          {icon}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red disabled:opacity-60"
        >
          {children}
        </select>
      </div>
    </label>
  )
}

export default function WhereHowWhen({
  city,
  area,
  mode,
  band,
  days,
  times,
  areas,
  onCity,
  onArea,
  onMode,
  onBand,
  onDays,
  onTimes,
}: {
  city: string
  area: string
  mode: string
  /** The budget BAND value (feeBands), not the min/max — the parent converts. */
  band: string
  days: string
  times: string
  /** Areas for the chosen city; empty disables the Area select. */
  areas: string[]
  onCity: (v: string) => void
  onArea: (v: string) => void
  onMode: (v: string) => void
  onBand: (v: string) => void
  onDays: (v: string) => void
  onTimes: (v: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <IconSelect icon={<Building2 size={15} />} label="City" value={city} onChange={onCity}>
          <option value="">City</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </IconSelect>

        <IconSelect
          icon={<MapPin size={15} />}
          label="Area"
          value={area}
          onChange={onArea}
          disabled={areas.length === 0}
        >
          <option value="">Area</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </IconSelect>

        <IconSelect
          icon={<MonitorSmartphone size={15} />}
          label="Mode"
          value={mode}
          onChange={onMode}
        >
          <option value="">Mode</option>
          {TEACHING_MODES.map((m) => (
            <option key={m} value={m}>
              {teachingMode(m)}
            </option>
          ))}
        </IconSelect>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <IconSelect icon={<Wallet size={15} />} label="Monthly budget" value={band} onChange={onBand}>
          {BUDGET_BANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.value === '' ? 'Budget' : b.label}
            </option>
          ))}
        </IconSelect>

        <IconSelect icon={<Calendar size={15} />} label="Days" value={days} onChange={onDays}>
          <option value="">Days</option>
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </IconSelect>

        <IconSelect icon={<Clock size={15} />} label="Times" value={times} onChange={onTimes}>
          <option value="">Time</option>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </IconSelect>
      </div>
    </>
  )
}
