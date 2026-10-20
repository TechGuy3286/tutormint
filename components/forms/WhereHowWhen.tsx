'use client'

import type { ReactNode } from 'react'
import { Building2, MapPin, Wallet } from 'lucide-react'

import { BUDGET_BANDS } from '@/lib/feeBands'
import LocationInput from '@/components/forms/LocationInput'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import StaffAreaField from '@/components/forms/StaffAreaField'
import CityPicker from '@/components/forms/CityPicker'
import { matchCuratedCity } from '@/lib/staffAreaCore'

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
  landmark = '',
  onLandmark,
  onSplit,
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
  /** Staff only (owner, 16 Oct 2026): the Block / landmark field. */
  landmark?: string
  onLandmark?: (v: string) => void
  /** A typed area that names a curated one: take that area + the rest as landmark. */
  onSplit?: (area: string, landmark: string) => void
}) {
  // The curated lists, from the DB (migration 73), fetched once and cached.
  // City and Area are datalist inputs: they suggest the curated names but accept
  // free text, so a locality outside the 23 cities is typed, not blocked.
  const { map } = useCityAreas()
  const areas = areasForCity(map, city)

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Staff choose the city from the curated list only (owner, 16 Oct
            2026) — no free text; the server refuses anything else. Parents keep
            the free-text field. */}
        {/* A searchable picker of every Pakistani city and town (owner, 20 Oct
            2026). Staff: the list only. Parents: the list, or their own text. */}
        {staff ? (
          <div className="space-y-1">
            <CityPicker value={city} onChange={onCity} icon={<Building2 size={15} />} />
            {city && map.cities.length > 0 && !staffCityValue(map.cities, city) && (
              <p className="text-[11px] font-semibold text-tm-red">{city} is not on the city list — choose a city.</p>
            )}
          </div>
        ) : (
          <CityPicker value={city} onChange={onCity} icon={<Building2 size={15} />} allowFreeText />
        )}

        {/* Staff may add a new area while posting (owner, 13 Oct 2026); parents
            keep the plain field, and their free text goes to the Locations
            review list as before. */}
        {staff ? (
          <StaffAreaField city={city} area={area} onArea={onArea} curated={areas} onSplit={onSplit} />
        ) : (
          <LocationInput
            id="whw-area"
            label="Area"
            icon={<MapPin size={15} />}
            value={area}
            onChange={onArea}
            options={areas}
            placeholder="Area"
          />
        )}

        <IconSelect icon={<Wallet size={15} />} label="Monthly budget" value={band} onChange={onBand}>
          {BUDGET_BANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.value === '' ? 'Budget' : b.label}
            </option>
          ))}
        </IconSelect>
      </div>
      {staff && onLandmark && (
        <label className="block space-y-1">
          <span className="text-[11px] font-bold text-gray-600">Block / landmark (optional)</span>
          <input
            type="text"
            value={landmark}
            maxLength={120}
            onChange={(e) => onLandmark(e.target.value)}
            placeholder="e.g. Block 1, Near Taj Complex"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red"
          />
        </label>
      )}
    </>
  )
}

/** The curated city a stored value names (case and spacing ignored), or ''. */
function staffCityValue(cities: string[], city: string): string {
  return matchCuratedCity(cities, city) ?? ''
}
