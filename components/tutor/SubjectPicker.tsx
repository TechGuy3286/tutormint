'use client'

import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { fetchNonLegacyMasters, labelsByMasterId, type SubjectMaster } from '@/lib/taxonomy'

// The tutor's subject picker (PR 3b §2.4).
//
// No level-dropdown GATE: the subjects are here immediately, grouped by level
// and ordered by open-job demand, multi-select, with a typeahead. Whatever is
// already saved shows selected. Selections are taxonomy_master ids (subject ×
// level) — exactly what tutor_subjects stores.
//
// To stay light on a settings page, the default view shows the in-demand
// subjects (and anything already selected) grouped by their level; the search
// reveals any subject across the whole taxonomy.

type Group = { level: string; demand: number; items: { id: number; label: string; demand: number }[] }

export default function SubjectPicker({
  value,
  onChange,
}: {
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const [masters, setMasters] = useState<SubjectMaster[]>([])
  const [demand, setDemand] = useState<Record<number, number>>({})
  const [labels, setLabels] = useState<Map<number, string>>(new Map())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      const ms = await fetchNonLegacyMasters()
      const d = await fetch('/api/tutor/demand', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      if (!live) return
      setMasters(ms)
      setDemand((d?.subjectDemand as Record<number, number>) ?? {})
      setLoading(false)
    })()
    return () => {
      live = false
    }
  }, [])

  // Labels for the current selection — covers a retired-taxonomy id too, so a
  // saved subject the pickers no longer offer still shows as a removable chip.
  useEffect(() => {
    let live = true
    if (value.length === 0) {
      setLabels(new Map())
      return
    }
    void labelsByMasterId(value).then((m) => {
      if (live) setLabels(m)
    })
    return () => {
      live = false
    }
  }, [value])

  const selected = useMemo(() => new Set(value), [value])
  const toggle = (id: number) =>
    onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id])

  const groups = useMemo<Group[]>(() => {
    const byLevel = new Map<string, Group>()
    for (const m of masters) {
      const g = byLevel.get(m.level) ?? { level: m.level, demand: 0, items: [] }
      const d = demand[m.id] ?? 0
      g.items.push({ id: m.id, label: m.subject ?? m.level, demand: d })
      g.demand += d
      byLevel.set(m.level, g)
    }
    const arr = [...byLevel.values()]
    for (const g of arr) g.items.sort((a, b) => b.demand - a.demand || a.label.localeCompare(b.label))
    arr.sort((a, b) => b.demand - a.demand || a.level.localeCompare(b.level))
    return arr
  }, [masters, demand])

  const q = query.trim().toLowerCase()
  const visibleGroups = useMemo<Group[]>(() => {
    return groups
      .map((g) => {
        const items = q
          ? g.items.filter(
              (it) => it.label.toLowerCase().includes(q) || g.level.toLowerCase().includes(q),
            )
          : // default view: in-demand subjects, plus anything already selected
            g.items.filter((it) => it.demand > 0 || selected.has(it.id))
        return { ...g, items }
      })
      .filter((g) => g.items.length > 0)
  }, [groups, q, selected])

  return (
    <div className="space-y-3">
      {/* Current selection — always visible, removable; retired-taxonomy picks
          included, so nothing saved is silently dropped. */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-lg border border-tm-green-deep/30 bg-tm-tint-green px-2.5 py-1 text-[11px] font-bold text-tm-green-deep"
            >
              {labels.get(id) ?? `#${id}`}
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Remove ${labels.get(id) ?? 'subject'}`}
                className="grid h-4 w-4 place-items-center rounded hover:bg-tm-green-deep/10"
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Typeahead — filters live, no button (the platform's instant-search rule). */}
      <div className="relative">
        <Search
          aria-hidden
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a subject or grade…"
          aria-label="Search subjects"
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg pl-9 pr-3 text-xs font-medium outline-none focus:border-tm-navy"
        />
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Loading subjects…
        </p>
      ) : visibleGroups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-3 text-center text-[11px] text-gray-500">
          {q ? `No subjects match “${query}”.` : 'Search for a subject or grade to add it.'}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((g) => (
            <div key={g.level} className="space-y-1.5">
              <p className="text-[11px] font-bold text-gray-500">{g.level}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => {
                  const on = selected.has(it.id)
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => toggle(it.id)}
                      aria-pressed={on}
                      className={`inline-flex min-h-[40px] items-center rounded-xl border px-3 text-[11px] font-bold transition-colors ${
                        on
                          ? 'border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {it.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
