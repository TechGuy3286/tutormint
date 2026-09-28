'use client'

import { MapPin, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import LocationInput from '@/components/forms/LocationInput'

// PR85 (Part A) — pick up to 2 cities, each with its own areas. Shared by tutor
// Settings ("Where you teach") and onboarding, so both save the same shape.
//
// The FIRST city is the main city (tutor_profiles.city) — unchanged so slugs and
// URLs stay put. Areas are grouped under their city ("Lahore: …", "Gujranwala:
// …"), at least one per chosen city. Reports the state up via onChange as
// { mainCity, areasByCity, valid } — the parent sends areasByCity to
// /api/profile/save.

export type CitiesState = {
  mainCity: string
  cities: string[]
  areasByCity: Record<string, string[]>
  valid: boolean
}

export default function TutorCitiesEditor({
  initialCities,
  initialAreasByCity,
  onChange,
}: {
  initialCities: string[]
  initialAreasByCity: Record<string, string[]>
  onChange: (s: CitiesState) => void
}) {
  const { map } = useCityAreas()
  const [cities, setCities] = useState<string[]>(
    initialCities.length > 0 ? initialCities.slice(0, 2) : [''],
  )
  // Areas kept BY INDEX (0 = main, 1 = second) so editing a city name never loses
  // its areas; the city name is the key only when we report up.
  const [areasByIndex, setAreasByIndex] = useState<Record<number, string[]>>(() => {
    const out: Record<number, string[]> = {}
    ;(initialCities.length > 0 ? initialCities.slice(0, 2) : ['']).forEach((c, i) => {
      out[i] = initialAreasByCity[c] ?? []
    })
    return out
  })
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  useEffect(() => {
    const areasByCity: Record<string, string[]> = {}
    const trimmed: string[] = []
    cities.forEach((c, i) => {
      const t = c.trim()
      if (!t) return
      trimmed.push(t)
      areasByCity[t] = [...new Set((areasByIndex[i] ?? []).map((a) => a.trim()).filter(Boolean))]
    })
    const valid = trimmed.length >= 1 && trimmed.every((c) => (areasByCity[c] ?? []).length > 0)
    onChange({ mainCity: trimmed[0] ?? '', cities: trimmed, areasByCity, valid })
    // onChange is recreated each render by the parent; depend on the data only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities, areasByIndex])

  const setCity = (i: number, v: string) => setCities((cs) => cs.map((c, j) => (j === i ? v : c)))
  const addArea = (i: number) => {
    const a = (drafts[i] ?? '').trim()
    if (!a) return
    setAreasByIndex((prev) => ({ ...prev, [i]: [...new Set([...(prev[i] ?? []), a])] }))
    setDrafts((d) => ({ ...d, [i]: '' }))
  }
  const removeArea = (i: number, a: string) =>
    setAreasByIndex((prev) => ({ ...prev, [i]: (prev[i] ?? []).filter((x) => x !== a) }))
  const addCity = () => {
    if (cities.length >= 2) return
    setCities((cs) => [...cs, ''])
    setAreasByIndex((prev) => ({ ...prev, [cities.length]: [] }))
  }
  const removeCity = (i: number) => {
    setCities((cs) => cs.filter((_, j) => j !== i))
    setAreasByIndex((prev) => {
      // Re-index the survivors so index 0/1 stay aligned with cities.
      const survivors = Object.entries(prev)
        .filter(([k]) => Number(k) !== i)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v)
      const out: Record<number, string[]> = {}
      survivors.forEach((v, j) => (out[j] = v))
      return out
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-gray-500">
        Choose up to 2 cities.
        <span lang="ur" dir="rtl" className="ms-1">زیادہ سے زیادہ 2 شہر منتخب کریں۔</span>
      </p>

      {cities.map((city, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <LocationInput
                id={`tutor-city-${i}`}
                label={i === 0 ? 'Main city' : 'Second city'}
                value={city}
                onChange={(v) => setCity(i, v)}
                options={map.cities}
                placeholder={i === 0 ? 'Main city' : 'Second city'}
                icon={<MapPin size={15} />}
              />
            </div>
            {i > 0 && (
              <button
                type="button"
                onClick={() => removeCity(i)}
                className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-tm-red hover:bg-tm-tint-red"
              >
                <X aria-hidden size={12} /> Remove
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="block text-[11px] font-bold text-tm-navy">
              Areas in {city.trim() || (i === 0 ? 'your main city' : 'this city')}
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                list={`areas-${i}`}
                autoComplete="off"
                value={drafts[i] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addArea(i)
                  }
                }}
                placeholder="Add an area"
                className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
              />
              <datalist id={`areas-${i}`}>
                {areasForCity(map, city).map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => addArea(i)}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy hover:border-tm-navy"
              >
                <Plus aria-hidden size={14} /> Add
              </button>
            </div>
            {(areasByIndex[i] ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {(areasByIndex[i] ?? []).map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-tm-red py-1 pl-2.5 pr-1 text-[11px] font-semibold text-white">
                    <span className="max-w-[10rem] truncate">{a}</span>
                    <button
                      type="button"
                      onClick={() => removeArea(i, a)}
                      aria-label={`Remove ${a}`}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/25"
                    >
                      <X aria-hidden size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] font-bold text-tm-red">Add at least one area for this city.</p>
            )}
          </div>
        </div>
      ))}

      {cities.length < 2 && (
        <button
          type="button"
          onClick={addCity}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
        >
          <Plus aria-hidden size={14} /> Add a second city
        </button>
      )}
    </div>
  )
}
