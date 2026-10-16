'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapPin, Plus } from 'lucide-react'

import LocationInput from '@/components/forms/LocationInput'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { getBrowserClient } from '@/lib/supabase/clientLazy'
import { addAreaToCache } from '@/lib/cityAreas'
import { areaKey, type CityAliases } from '@/lib/areaHubCore'
import { splitAreaLandmark, staffAreaAdvice } from '@/lib/staffAreaCore'

// The Area field of the STAFF "Post a tuition" form (owner, 13 Oct 2026).
//
// Any text is accepted and posting is never blocked. While staff type, the
// field offers the city's curated areas and the spellings that already count as
// one. When the text is neither, it shows "Did you mean <closest>?" and
// "Add '<name>' as new area" — which saves the area to the curated list at once
// (the city must be chosen), so the next post by anyone can pick it.

type AliasRow = { raw: string; area: string }

export default function StaffAreaField({
  city,
  area,
  onArea,
  curated,
  onSplit,
}: {
  city: string
  area: string
  onArea: (v: string) => void
  /** The curated areas of the chosen city. */
  curated: string[]
  /** "Clifton Block 1" → Clifton + "Block 1" (owner, 16 Oct 2026). */
  onSplit?: (area: string, landmark: string) => void
}) {
  const toast = useToast()
  // Kept with the city they were loaded for, so a change of city never shows the last city's spellings.
  const [loaded, setLoaded] = useState<{ city: string; rows: AliasRow[] }>({ city: '', rows: [] })
  const [added, setAdded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // The spellings that already count as a curated area in this city.
  useEffect(() => {
    let live = true
    const name = city.trim()
    if (!name) return
    void (async () => {
      try {
        const sb = await getBrowserClient()
        const { data } = await sb
          .from('location_area_aliases')
          .select('raw, location_cities!inner(name), location_areas(name)')
          .is('removed_at', null)
          .ilike('location_cities.name', name)
          .limit(1000)
        const one = (v: unknown) => ((Array.isArray(v) ? v[0] : v) as { name?: string } | null)?.name ?? ''
        if (live) setLoaded({ city: name, rows: ((data ?? []) as { raw: string; location_areas: unknown }[]).map((r) => ({ raw: r.raw, area: one(r.location_areas) })).filter((r) => r.raw && r.area) })
      } catch {
        /* the curated list alone still works */
      }
    })()
    return () => {
      live = false
    }
  }, [city])

  const aliasRows = useMemo(() => (loaded.city === city.trim() ? loaded.rows : []), [loaded, city])
  const list = useMemo(() => [...new Set([...curated, ...added])].sort((a, b) => a.localeCompare(b)), [curated, added])
  const aliases = useMemo(() => {
    const out: CityAliases = {}
    for (const r of aliasRows) {
      const k = areaKey(r.raw, city)
      if (k) out[k] = r.area
    }
    return out
  }, [aliasRows, city])
  const options = useMemo(() => [...new Set([...list, ...aliasRows.map((r) => r.raw)])], [list, aliasRows])
  const advice = staffAreaAdvice(city, area, list, aliases)
  // A typed area that names a curated one, with a block or landmark around it.
  const split = onSplit ? splitAreaLandmark(city, area, list, aliases) : null
  const applySplit = () => {
    if (split && onSplit) onSplit(split.area, split.landmark)
  }

  const add = async (name: string) => {
    if (!city.trim()) {
      toast.error('Choose the city first, then add the area.')
      return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; area?: string; existed?: boolean }>('/api/admin/locations/area', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', city, name }),
    })
    setBusy(false)
    if (!ok || !data?.area) {
      // Never blocks posting: the typed text stays in the field as it is.
      toast.error(data?.error ?? 'The area was not added. You can still post with the area as typed.')
      return
    }
    setAdded((cur) => [...cur, data.area!])
    addAreaToCache(city, data.area)
    onArea(data.area)
    toast.success(data.existed ? `${data.area} is already in the list.` : `${data.area} added to ${city}.`)
  }

  const CHIP = 'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold disabled:opacity-60'

  return (
    <div
      className="space-y-1.5"
      // When staff leave the field, the main area is selected and the rest goes
      // to Block / landmark (owner, 16 Oct 2026).
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) applySplit()
      }}
    >
      <LocationInput id="whw-area" label="Area" icon={<MapPin size={15} />} value={area} onChange={onArea} options={options} placeholder="Area" />
      {advice.kind === 'listed' && !advice.exact && <p className="text-[11px] text-gray-600">Counts as {advice.area}.</p>}
      {split && (
        <div role="status" className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={applySplit} className={`${CHIP} border-tm-navy bg-tm-tint-navy text-tm-navy`}>
            Use {split.area} ({split.landmark})
          </button>
        </div>
      )}
      {!split && advice.kind === 'new' && (
        <div role="status" className="flex flex-wrap items-center gap-1.5">
          {advice.didYouMean && (
            <button type="button" onClick={() => onArea(advice.didYouMean!)} className={`${CHIP} border-tm-navy bg-tm-tint-navy text-tm-navy`}>
              Did you mean {advice.didYouMean}?
            </button>
          )}
          {advice.addName && (
            <button type="button" disabled={busy} onClick={() => void add(advice.addName!)} className={`${CHIP} border-gray-200 bg-white text-slate-700 hover:border-tm-navy`}>
              <Plus aria-hidden size={12} />
              {busy ? 'Adding…' : `Add “${advice.addName}” as new area`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
