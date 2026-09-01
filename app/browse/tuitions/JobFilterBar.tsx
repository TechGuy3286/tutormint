'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlidersHorizontal, Search, X } from 'lucide-react'
import { CITIES, TEACHING_MODES } from '@/lib/locations'
import {
  fetchLevels,
  fetchGradesForLevel,
  fetchSubjectsForGrade,
  isLevelLeaf,
  resolveMasterIds,
} from '@/lib/taxonomy'

// Filters for the tuition board. Like the tutor filter bar, it writes the URL
// and lets the server re-render -- the ranked list stays in the HTML.

export type JobFilterValues = {
  subject: string
  subjectLabel: string | null
  city: string
  mode: string
  budgetMin: string
  budgetMax: string
  q: string
}

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-[#0F172A] outline-none focus:border-[#d60008]'

export default function JobFilterBar({ values }: { values: JobFilterValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState(values.q)

  const [categories, setCategories] = useState<string[]>([])
  const [levels, setLevels] = useState<string[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')

  useEffect(() => {
    fetchLevels().then(setCategories).catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    if (!category) {
      setLevels([])
      setLevel('')
      return
    }
    fetchGradesForLevel(category).then(setLevels).catch(() => setLevels([]))
  }, [category])

  useEffect(() => {
    if (!category || !level) {
      setSubjects([])
      return
    }
    fetchSubjectsForGrade(category, level).then(setSubjects).catch(() => setSubjects([]))
  }, [category, level])

  const activeCount = [values.subject, values.city, values.mode, values.budgetMin, values.budgetMax, values.q]
    .filter(Boolean).length

  const apply = (patch: Record<string, string | null>) => {
    const merged: Record<string, string> = {
      subject: values.subject,
      city: values.city,
      mode: values.mode,
      budgetMin: values.budgetMin,
      budgetMax: values.budgetMax,
      q: values.q,
    }
    for (const [k, v] of Object.entries(patch)) merged[k] = v ?? ''
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v)
    router.push(params.toString() ? `/browse/tuitions?${params}` : '/browse/tuitions')
  }

  const applySubject = async (subjectName: string) => {
    if (!category || !level) return
    const ids = await resolveMasterIds(category, level, subjectName ? [subjectName] : [])
    apply({ subject: ids[0] ? String(ids[0]) : null })
    setOpen(false)
  }

  const chooseLevel = async (next: string) => {
    setLevel(next)
    if (next && (await isLevelLeaf(category, next))) {
      const ids = await resolveMasterIds(category, next, [])
      if (ids[0]) {
        apply({ subject: String(ids[0]) })
        setOpen(false)
      }
    }
  }

  const panel = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Category</span>
          <select
            className={FIELD}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setLevel('')
            }}
          >
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Level</span>
          <select className={FIELD} value={level} disabled={!category} onChange={(e) => chooseLevel(e.target.value)}>
            <option value="">Any level</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Subject</span>
          <select
            className={FIELD}
            defaultValue=""
            disabled={!level || subjects.length === 0}
            onChange={(e) => applySubject(e.target.value)}
          >
            <option value="">Any subject</option>
            {subjects.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">City</span>
          <select className={FIELD} value={values.city} onChange={(e) => apply({ city: e.target.value })}>
            <option value="">Any city</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Mode</span>
          <select className={FIELD} value={values.mode} onChange={(e) => apply({ mode: e.target.value })}>
            <option value="">Any mode</option>
            {TEACHING_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Budget from</span>
          <input
            type="number"
            inputMode="numeric"
            className={FIELD}
            defaultValue={values.budgetMin}
            onBlur={(e) => e.target.value !== values.budgetMin && apply({ budgetMin: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Budget up to</span>
          <input
            type="number"
            inputMode="numeric"
            className={FIELD}
            defaultValue={values.budgetMax}
            onBlur={(e) => e.target.value !== values.budgetMax && apply({ budgetMax: e.target.value })}
          />
        </label>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply({ q })
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tuitions"
            aria-label="Search tuitions"
            className={`${FIELD} pl-9`}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-[#0F172A] lg:hidden"
        >
          <SlidersHorizontal size={16} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-[#d60008] px-1.5 text-[10px] font-black text-white">
              {activeCount}
            </span>
          )}
        </button>
      </form>

      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {values.subjectLabel && <Chip label={values.subjectLabel} onClear={() => apply({ subject: null })} />}
          {values.city && <Chip label={values.city} onClear={() => apply({ city: null })} />}
          {values.mode && <Chip label={values.mode} onClear={() => apply({ mode: null })} />}
          {values.budgetMin && <Chip label={`from Rs.${values.budgetMin}`} onClear={() => apply({ budgetMin: null })} />}
          {values.budgetMax && <Chip label={`to Rs.${values.budgetMax}`} onClear={() => apply({ budgetMax: null })} />}
          {values.q && <Chip label={`"${values.q}"`} onClear={() => { setQ(''); apply({ q: null }) }} />}
          <button
            type="button"
            onClick={() => router.push('/browse/tuitions')}
            className="text-[11px] font-bold text-[#d60008] underline"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="hidden lg:block">{panel}</div>
      {open && <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:hidden">{panel}</div>}
    </div>
  )
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#0F172A] px-2.5 py-1 text-[11px] font-bold text-white">
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label} filter`} className="p-0.5">
        <X size={12} />
      </button>
    </span>
  )
}
