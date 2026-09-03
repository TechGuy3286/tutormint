'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import { CITIES, TEACHING_MODES } from '@/lib/locations'
import Typeahead from '@/components/search/Typeahead'
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
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'

export default function JobFilterBar({ values }: { values: JobFilterValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

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

  const apply = (patch: Record<string, string | null>, opts?: { replace?: boolean }) => {
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
    const href = params.toString() ? `/browse/tuitions?${params}` : '/browse/tuitions'
    if (opts?.replace) router.replace(href, { scroll: false })
    else router.push(href)
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

  // At lg the three field groups become ONE five-column grid via `contents`,
  // so nine filters occupy two rows instead of three. That is ~70px of an
  // 800px laptop viewport handed back to the results, which is the point of
  // the 3 Sep spacing pass: on a browse page the results are the content and
  // the controls are not.
  //
  // Below lg the groups keep their own rows, because the cascade reads as a
  // cascade — category, then level, then subject — and flattening it on a
  // phone would put "Subject" beside "City".
  const panel = (
    <div className="space-y-2 lg:grid lg:grid-cols-5 lg:gap-2 lg:space-y-0">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:contents">
        <label className="space-y-0.5">
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
        <label className="space-y-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Level</span>
          <select className={FIELD} value={level} disabled={!category} onChange={(e) => chooseLevel(e.target.value)}>
            <option value="">Any level</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:contents">
        <label className="space-y-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">City</span>
          <select className={FIELD} value={values.city} onChange={(e) => apply({ city: e.target.value })}>
            <option value="">Any city</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Mode</span>
          <select className={FIELD} value={values.mode} onChange={(e) => apply({ mode: e.target.value })}>
            <option value="">Any mode</option>
            {TEACHING_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Budget from</span>
          <input
            type="number"
            inputMode="numeric"
            className={FIELD}
            defaultValue={values.budgetMin}
            onBlur={(e) => e.target.value !== values.budgetMin && apply({ budgetMin: e.target.value })}
          />
        </label>
        <label className="space-y-0.5">
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
    <div className="space-y-2">
      <div className="flex gap-2">
        <Typeahead
          initialQuery={values.q}
          placeholder="Search subjects, cities or jobs"
          ariaLabel="Search tuitions"
          city={values.city || undefined}
          groups={['subject', 'location', 'job']}
          onQueryChange={(next) => apply({ q: next }, { replace: true })}
          onCommit={(next) => apply({ q: next })}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-tm-navy lg:hidden"
        >
          <SlidersHorizontal size={16} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-tm-red px-1.5 text-[10px] font-black text-white">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {values.subjectLabel && <Chip label={values.subjectLabel} onClear={() => apply({ subject: null })} />}
          {values.city && <Chip label={values.city} onClear={() => apply({ city: null })} />}
          {values.mode && <Chip label={values.mode} onClear={() => apply({ mode: null })} />}
          {values.budgetMin && <Chip label={`from Rs.${values.budgetMin}`} onClear={() => apply({ budgetMin: null })} />}
          {values.budgetMax && <Chip label={`to Rs.${values.budgetMax}`} onClear={() => apply({ budgetMax: null })} />}
          {values.q && <Chip label={`"${values.q}"`} onClear={() => apply({ q: null })} />}
          <button
            type="button"
            onClick={() => router.push('/browse/tuitions')}
            className="text-[11px] font-bold text-tm-red underline"
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
    <span className="inline-flex items-center gap-1 rounded-full bg-tm-black px-2.5 py-1 text-[11px] font-bold text-white">
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label} filter`} className="p-0.5">
        <X size={12} />
      </button>
    </span>
  )
}
