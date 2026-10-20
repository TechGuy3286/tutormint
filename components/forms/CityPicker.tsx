'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

import type { PkCity } from '@/lib/pkCityData'
import { citySubtitle, foldCity, searchCities } from '@/lib/pkCitiesCore'

// The searchable city picker (owner, 20 Oct 2026), used everywhere a city is
// chosen: Post a tuition, the staff edit, tutor onboarding, tutor and parent
// Settings and the Browse filters. Type to filter by name or alias ("D.I.
// Khan", "Shaheed Benazirabad"); each result shows its district and province;
// the biggest cities come first. The list of ~420 places is loaded only when
// the picker is first opened, so no page carries it in its first load.
//
// `only` limits the choices (the Browse filter: cities with tuitions or
// tutors). `allowFreeText` keeps today's member rule — a locality not on the
// list can be typed and kept. Staff posting is curated-only (no free text), and
// the server still refuses any other city there.
//
// Keyboard: Enter / Space / ArrowDown open; ArrowUp / ArrowDown move; Enter
// chooses; Escape closes. 44px rows; the list fits a 360px screen.

let dataPromise: Promise<PkCity[]> | null = null
function loadCities(): Promise<PkCity[]> {
  dataPromise ??= import('@/lib/pkCityData').then((m) => m.PK_CITIES)
  return dataPromise
}

type Row = { name: string; sub: string | null }

export default function CityPicker({
  value,
  onChange,
  label = 'City',
  placeholder = 'City',
  icon,
  only,
  allowFreeText = false,
  emptyLabel,
  disabled = false,
  className = '',
  counts,
}: {
  value: string
  onChange: (city: string) => void
  /** Names the control for assistive tech. */
  label?: string
  placeholder?: string
  icon?: ReactNode
  /** Offer only these city names (in this order). */
  only?: string[]
  /** Members may keep a locality that is not on the list. */
  allowFreeText?: boolean
  /** A first row that clears the choice ("Any city") — for filters. */
  emptyLabel?: string
  disabled?: boolean
  className?: string
  /** A number shown after a city's name, e.g. its tutors (keyed by name). */
  counts?: Record<string, number>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [cities, setCities] = useState<PkCity[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open || cities) return
    let alive = true
    loadCities().then((c) => alive && setCities(c)).catch(() => alive && setCities([]))
    return () => {
      alive = false
    }
  }, [open, cities])

  const pool = useMemo(() => {
    const all = cities ?? []
    if (!only) return all
    // The restricted list in the picker's own order (biggest first); a name
    // that is not on the city list (typed by a member) comes last, as it is.
    const wanted = new Set(only.map(foldCity))
    const listed = all.filter((c) => wanted.has(foldCity(c.name)))
    const known = new Set(listed.map((c) => foldCity(c.name)))
    const extra = only
      .filter((n) => !known.has(foldCity(n)))
      .map((n) => ({ name: n, province: '', district: '', lat: 0, lng: 0, population: 0, aliases: [], existing: false }))
    return [...listed, ...extra]
  }, [cities, only])

  const rows: Row[] = useMemo(() => {
    const found = searchCities(pool, query, 60).map((c) => ({ name: c.name, sub: c.province ? citySubtitle(c) : null }))
    const typed = query.trim()
    if (allowFreeText && typed && !found.some((r) => foldCity(r.name) === foldCity(typed))) found.push({ name: typed, sub: 'Not on the list — use as typed' })
    return found
  }, [pool, query, allowFreeText])
  const withEmpty = emptyLabel ? [{ name: '', sub: null }, ...rows] : rows

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [open])

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, listId])

  const openPicker = () => {
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  const choose = (name: string) => {
    onChange(name)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openPicker()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(withEmpty.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = withEmpty[active]
      if (r) choose(r.name)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && (open ? setOpen(false) : openPicker())}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-left text-xs font-semibold text-tm-navy outline-none focus:border-tm-red disabled:opacity-60"
      >
        {icon && <span aria-hidden className="shrink-0 text-gray-500">{icon}</span>}
        <span className={`flex-1 truncate ${value ? '' : 'text-gray-500'}`}>{value || emptyLabel || placeholder}</span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-gray-500" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center border-b border-gray-100">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(emptyLabel ? 1 : 0)
              }}
              placeholder="Type a city or town"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={listId}
              autoComplete="off"
              enterKeyHint="search"
              className="min-h-[44px] w-full px-3 text-base text-slate-700 outline-none sm:text-xs"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="flex min-h-[44px] min-w-[44px] items-center justify-center text-gray-500">
                <X size={14} aria-hidden />
              </button>
            )}
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain py-1">
            {!cities ? (
              [0, 1, 2].map((i) => (
                <li key={i} aria-hidden className="space-y-1 px-3 py-2">
                  <span className="block h-3 w-2/5 animate-pulse rounded bg-gray-200" />
                  <span className="block h-2.5 w-3/5 animate-pulse rounded bg-gray-100" />
                </li>
              ))
            ) : withEmpty.length === 0 ? (
              <li className="px-3 py-3 text-[11px] text-gray-500">No city matches “{query.trim()}”.</li>
            ) : (
              withEmpty.map((r, i) => {
                const selected = foldCity(r.name) === foldCity(value)
                return (
                  <li
                    key={`${r.name}-${i}`}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r.name)}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? 'bg-tm-tint-navy' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs ${selected ? 'font-bold text-tm-navy' : 'font-semibold text-slate-700'}`}>
                        {r.name || emptyLabel}
                        {r.name && counts?.[r.name] !== undefined && <span className="font-normal text-gray-500"> ({counts[r.name]})</span>}
                      </span>
                      {r.sub && <span className="block truncate text-[11px] text-gray-500">{r.sub}</span>}
                    </span>
                    {selected && <Check size={14} aria-hidden className="shrink-0 text-tm-navy" />}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
