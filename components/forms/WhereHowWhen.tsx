'use client'

import type { ReactNode } from 'react'
import { Building2, MapPin, Wallet } from 'lucide-react'

import { BUDGET_BANDS } from '@/lib/feeBands'
import LocationInput from '@/components/forms/LocationInput'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import { areaStanding } from '@/lib/areaHubCore'

// The "Where and how" row of the job form — city, area and budget. "When" is now
// the shared TimeSlotGrid, rendered by the form beside this (PR73 §A).
//
// SHARED by the parent post-a-tuition form AND the admin team-post form, so the
// two cannot drift: an icon or a placeholder changed here changes in both. Each
// select carries a recognising icon and a short placeholder that is the field's
// own noun — "City", not "Choose a city".

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
  band,
  onCity,
  onArea,
  onBand,
  staff = false,
}: {
  city: string
  area: string
  /** The budget BAND value (feeBands), not the min/max — the parent converts. */
  band: string
  onCity: (v: string) => void
  onArea: (v: string) => void
  onBand: (v: string) => void
  /** Staff see what an area that is not in Locations means (owner, 13 Oct 2026). */
  staff?: boolean
}) {
  // The curated lists, from the DB (migration 73), fetched once and cached.
  // City and Area are datalist inputs: they suggest the curated names but accept
  // free text, so a locality outside the 23 cities is typed, not blocked.
  const { map } = useCityAreas()
  const areas = areasForCity(map, city)
  // An area page is only made for an area in Locations (lib/areaHubCore). A new
  // one is saved as typed and waits, unlisted, until an admin adds it.
  const standing = staff ? areaStanding(city, area, areas) : null

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LocationInput
          id="whw-city"
          label="City"
          icon={<Building2 size={15} />}
          value={city}
          onChange={onCity}
          options={map.cities}
          placeholder="City"
        />

        <LocationInput
          id="whw-area"
          label="Area"
          icon={<MapPin size={15} />}
          value={area}
          onChange={onArea}
          options={areas}
          placeholder="Area"
        />

        <IconSelect icon={<Wallet size={15} />} label="Monthly budget" value={band} onChange={onBand}>
          {BUDGET_BANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.value === '' ? 'Budget' : b.label}
            </option>
          ))}
        </IconSelect>
      </div>
      {standing?.kind === 'unlisted' && (
        <p role="status" className="mt-2 rounded-lg border border-tm-gold/40 bg-tm-tint-gold px-3 py-2 text-xs text-tm-gold-ink">
          {standing.looksLikeSchool
            ? 'This looks like a school or academy name, not an area. Put it in “School or academy name” and choose the area it is in.'
            : 'This area is not in the Locations list. It is saved as typed, but gets its own area page only after an admin adds it to Locations.'}
        </p>
      )}
      {standing?.kind === 'listed' && standing.how === 'contains' && (
        <p className="mt-2 text-xs text-gray-500">Listed under {standing.area}.</p>
      )}
    </>
  )
}
