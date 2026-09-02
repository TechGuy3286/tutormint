'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import { CITIES, CITY_AREAS, TEACHING_MODES, GENDERS } from '@/lib/locations'
import Typeahead from '@/components/search/Typeahead'
import {
  fetchLevels,
  fetchGradesForLevel,
  fetchSubjectsForGrade,
  isLevelLeaf,
  resolveMasterIds,
} from '@/lib/taxonomy'

// The only client-side part of /browse/tutors.
//
// It does not fetch, filter or sort tutors -- it writes the URL, and the
// server component re-renders the ranked results. That keeps the SEO rule
// intact (results are in the HTML) and keeps ranking where it is sold from:
// the database.
//
// Subjects are never free text. The cascade resolves the choice to a
// taxonomy_master id, which is what tutor_subjects stores, so "AS & A Levels
// Mathematics" matches only that, never "Mathematics" at Primary.

export type FilterValues = {
  subject: string
  subjectLabel: string | null
  city: string
  area: string
  mode: string
  gender: string
  feeMin: string
  feeMax: string
  q: string
}

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'

export default function TutorFilterBar({ values }: { values: FilterValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Taxonomy cascade
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

  const areas = useMemo(() => (values.city ? (CITY_AREAS[values.city] ?? []) : []), [values.city])

  const activeCount = [
    values.subject,
    values.city,
    values.area,
    values.mode,
    values.gender,
    values.feeMin,
    values.feeMax,
    values.q,
  ].filter(Boolean).length

  /** Rewrites the query string; page always resets so filters cannot strand
      the reader on an empty page 4. */
  const apply = (patch: Record<string, string | null>, opts?: { replace?: boolean }) => {
    const params = new URLSearchParams()
    const merged: Record<string, string> = {
      subject: values.subject,
      city: values.city,
      area: values.area,
      mode: values.mode,
      gender: values.gender,
      feeMin: values.feeMin,
      feeMax: values.feeMax,
      q: values.q,
    }
    for (const [k, v] of Object.entries(patch)) merged[k] = v ?? ''
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v)
    const href = params.toString() ? `/browse/tutors?${params}` : '/browse/tutors'
    if (opts?.replace) router.replace(href, { scroll: false })
    else router.push(href)
  }

  const applySubject = async (subjectName: string) => {
    if (!category || !level) return
    const ids = await resolveMasterIds(category, level, subjectName ? [subjectName] : [])
    apply({ subject: ids[0] ? String(ids[0]) : null })
    setOpen(false)
  }

  const chooseLevel = async (nextLevel: string) => {
    setLevel(nextLevel)
    // Test Preparations, Sports & Games and Holy Quran have no subject tier:
    // the level itself is the selectable item.
    if (nextLevel && (await isLevelLeaf(category, nextLevel))) {
      const ids = await resolveMasterIds(category, nextLevel, [])
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
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Level</span>
          <select
            className={FIELD}
            value={level}
            disabled={!category}
            onChange={(e) => chooseLevel(e.target.value)}
          >
            <option value="">Any level</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
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
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">City</span>
          <select
            className={FIELD}
            value={values.city}
            onChange={(e) => apply({ city: e.target.value, area: null })}
          >
            <option value="">Any city</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Area</span>
          <select
            className={FIELD}
            value={values.area}
            disabled={areas.length === 0}
            onChange={(e) => apply({ area: e.target.value })}
          >
            <option value="">Any area</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Mode</span>
          <select className={FIELD} value={values.mode} onChange={(e) => apply({ mode: e.target.value })}>
            <option value="">Any mode</option>
            {TEACHING_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Gender</span>
          <select
            className={FIELD}
            value={values.gender}
            onChange={(e) => apply({ gender: e.target.value })}
          >
            <option value="">Any</option>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Fee from (PKR)
          </span>
          <input
            type="number"
            inputMode="numeric"
            className={FIELD}
            defaultValue={values.feeMin}
            onBlur={(e) => e.target.value !== values.feeMin && apply({ feeMin: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Fee up to (PKR)
          </span>
          <input
            type="number"
            inputMode="numeric"
            className={FIELD}
            defaultValue={values.feeMax}
            onBlur={(e) => e.target.value !== values.feeMax && apply({ feeMax: e.target.value })}
          />
        </label>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Typeahead
          initialQuery={values.q}
          placeholder="Search subjects, cities or tutors"
          ariaLabel="Search tutors"
          city={values.city || undefined}
          // Live: every debounced change rewrites the URL and the server
          // re-renders the ranked grid underneath. replace(), not push(), so
          // refining a search does not fill the back button with keystrokes.
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

      {/* Active filters, always visible so nobody wonders why results are thin. */}
      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {values.subjectLabel && (
            <Chip label={values.subjectLabel} onClear={() => apply({ subject: null })} />
          )}
          {values.city && <Chip label={values.city} onClear={() => apply({ city: null, area: null })} />}
          {values.area && <Chip label={values.area} onClear={() => apply({ area: null })} />}
          {values.mode && <Chip label={values.mode} onClear={() => apply({ mode: null })} />}
          {values.gender && <Chip label={values.gender} onClear={() => apply({ gender: null })} />}
          {values.feeMin && <Chip label={`from Rs.${values.feeMin}`} onClear={() => apply({ feeMin: null })} />}
          {values.feeMax && <Chip label={`to Rs.${values.feeMax}`} onClear={() => apply({ feeMax: null })} />}
          {values.q && <Chip label={`"${values.q}"`} onClear={() => apply({ q: null })} />}
          <button
            type="button"
            onClick={() => router.push('/browse/tutors')}
            className="text-[11px] font-bold text-tm-red underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Sheet on mobile, always-open panel from lg. */}
      <div className="hidden lg:block">{panel}</div>
      {open && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:hidden">{panel}</div>
      )}
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
