'use client'

import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import TaxonomySelector from '@/components/TaxonomySelector'
import { isLevelLeaf, resolveMasterIds, selectionForMasterIds } from '@/lib/taxonomy'
import { CITIES, CITY_AREAS, TEACHING_MODES } from '@/lib/locations'
import { teachingMode } from '@/lib/display'
import { takeDraft, saveDraft } from '@/components/AuthGateModal'

// Post or edit a tuition.
//
// Subjects are chosen through TaxonomySelector and resolved to
// taxonomy_master ids before submit -- no free-text subject ever leaves this
// form, which is what makes "AS & A Levels Mathematics" match only that.
// Levels that are leaves in their own right (Test Preparations, Sports &
// Games, Holy Quran) have no subject step, and the level itself is submitted.
//
// The draft survives a trip through sign-in: it is written to sessionStorage
// (a draft only -- never login or role state) and read back on return.

export type JobFormValues = {
  jobId?: string
  /** Stored taxonomy_master ids, resolved back into the cascade on mount. */
  masterIds?: number[]
  title: string
  category: string
  level: string
  subjects: string[]
  classLevel: string
  city: string
  area: string
  teachingMode: string
  budgetPkr: string
  schedule: string
  description: string
  childId: string
}

const EMPTY: JobFormValues = {
  title: '',
  category: '',
  level: '',
  subjects: [],
  classLevel: '',
  city: '',
  area: '',
  teachingMode: '',
  budgetPkr: '',
  schedule: '',
  description: '',
  childId: '',
}

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'

export default function JobForm({
  children,
  initial,
  mode = 'create',
}: {
  children: { id: string; name: string; class_level: string | null }[]
  initial?: Partial<JobFormValues>
  mode?: 'create' | 'edit'
}) {
  const router = useRouter()
  const [v, setV] = useState<JobFormValues>({ ...EMPTY, ...initial })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const upgradeSheet = useUpgradeSheet()
  const [levelLeaf, setLevelLeaf] = useState(false)
  // Editing has to wait for the reverse lookup before the cascade renders,
  // otherwise TaxonomySelector mounts empty and helpfully selects the first
  // category for us -- overwriting the job's real subjects.
  const [ready, setReady] = useState(mode !== 'edit' || !initial?.masterIds?.length)

  // A draft saved before sign-in comes back here.
  useEffect(() => {
    if (mode !== 'create') return
    const draft = takeDraft<JobFormValues>('post')
    if (draft) setV({ ...EMPTY, ...draft })
  }, [mode])

  // Pre-select what the job already teaches.
  useEffect(() => {
    const ids = initial?.masterIds
    if (mode !== 'edit' || !ids || ids.length === 0) return
    let cancelled = false
    selectionForMasterIds(ids)
      .then((sel) => {
        if (cancelled) return
        setV((prev) => ({
          ...prev,
          category: sel.category,
          level: sel.level,
          subjects: sel.subjects,
        }))
        setReady(true)
      })
      .catch(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (!v.category || !v.level) {
      setLevelLeaf(false)
      return
    }
    isLevelLeaf(v.category, v.level).then(setLevelLeaf).catch(() => setLevelLeaf(false))
  }, [v.category, v.level])

  const set = <K extends keyof JobFormValues>(k: K, value: JobFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }))

  const areas = v.city ? (CITY_AREAS[v.city] ?? []) : []

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const masterIds = await resolveMasterIds(v.category, v.level, levelLeaf ? [] : v.subjects)
      if (masterIds.length === 0) {
        throw new Error('Choose a category, level and at least one subject.')
      }

      const payload = {
        jobId: v.jobId,
        title: v.title,
        masterIds,
        classLevel: v.level || v.classLevel,
        city: v.city,
        area: v.area,
        teachingMode: v.teachingMode,
        budgetPkr: v.budgetPkr,
        schedule: v.schedule,
        description: v.description,
        childId: v.childId || null,
      }

      const r = await postGated<{ jobTxId: string }>(
        '/api/parent/jobs',
        payload,
        upgradeSheet?.showGate,
        mode === 'edit' ? 'PATCH' : 'POST',
      )

      if (!r.ok) {
        // The draft is kept whatever the refusal was, so nothing typed is lost
        // -- including when the member goes off to upgrade and comes back.
        saveDraft('post', v)
        if (!r.gated) setError(r.error)
        setBusy(false)
        return
      }

      router.push(
        mode === 'edit' ? `/parent/dashboard/job/${v.jobId}` : `/parent/dashboard/job/${r.data.jobTxId}`,
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the job.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <label className="block space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            What do you need?
          </span>
          <input
            value={v.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. O Level Physics tutor, DHA Phase 5"
            className={FIELD}
          />
        </label>

        {children.length > 0 && (
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              For which child? (optional, never shown publicly)
            </span>
            <select value={v.childId} onChange={(e) => set('childId', e.target.value)} className={FIELD}>
              <option value="">Not specified</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.class_level ? ` — ${c.class_level}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-black text-tm-navy">Subject</h2>
        {!ready ? (
          <p className="rounded-xl bg-tm-bg p-3 text-[11px] text-gray-500">
            Loading the subjects on this job…
          </p>
        ) : (
        <TaxonomySelector
          selectedLevel={v.category}
          setSelectedLevel={(x) => setV((p) => ({ ...p, category: x, level: '', subjects: [] }))}
          selectedGrade={v.level}
          setSelectedGrade={(x) => setV((p) => ({ ...p, level: x, subjects: [] }))}
          selectedSubjects={v.subjects}
          setSelectedSubjects={(x) => set('subjects', x)}
        />
        )}
        {levelLeaf && (
          <p className="rounded-xl bg-tm-bg p-3 text-[11px] text-gray-500">
            {v.level} is chosen on its own — there is no subject list beneath it.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-black text-tm-navy">Where and how</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">City</span>
            <select
              value={v.city}
              onChange={(e) => setV((p) => ({ ...p, city: e.target.value, area: '' }))}
              className={FIELD}
            >
              <option value="">Choose a city</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Area</span>
            <select
              value={v.area}
              onChange={(e) => set('area', e.target.value)}
              disabled={areas.length === 0}
              className={FIELD}
            >
              <option value="">Any area</option>
              {areas.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Mode</span>
            <select
              value={v.teachingMode}
              onChange={(e) => set('teachingMode', e.target.value)}
              className={FIELD}
            >
              <option value="">Any</option>
              {TEACHING_MODES.map((m) => (
                <option key={m} value={m}>{teachingMode(m)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Monthly budget (PKR)
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={v.budgetPkr}
              onChange={(e) => set('budgetPkr', e.target.value)}
              placeholder="25000"
              className={FIELD}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Days and times
            </span>
            <input
              value={v.schedule}
              onChange={(e) => set('schedule', e.target.value)}
              placeholder="e.g. Mon/Wed/Fri, evenings"
              className={FIELD}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Anything else tutors should know
          </span>
          <textarea
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
            rows={4}
            placeholder="Current grades, exam board, what you are hoping to achieve…"
            className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none focus:border-tm-red"
          />
        </label>
      </section>

      {error && (
        <p className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
          {error}{' '}
        </p>
      )}

      {/* Sticky on mobile: the primary action must be reachable without
          scrolling back through a long form. */}
      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:bg-gray-300 sm:w-auto"
        >
          {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Post this tuition'}
        </button>
      </div>
    </div>
  )
}
