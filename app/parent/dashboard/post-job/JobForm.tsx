'use client'

import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, Info } from 'lucide-react'
import TaxonomySelector from '@/components/TaxonomySelector'
import { isLevelLeaf, resolveMasterIds, selectionForMasterIds } from '@/lib/taxonomy'
import { CITIES, CITY_AREAS, TEACHING_MODES } from '@/lib/locations'
import { BUDGET_BANDS, bandFor, bandRange } from '@/lib/feeBands'
import { teachingMode } from '@/lib/display'
import { takeDraft, saveDraft } from '@/components/AuthGateModal'

// Post or edit a tuition.
//
// ONE ACTIVITY, ONE CARD. This was four boxed cards -- "What do you need?",
// "Subject", "Where and how" -- which read as four separate things to manage
// and made a single short task look like an afternoon. It is one surface now
// with numbered steps and quiet dividers: the same fields, one job.
//
// SELECTION, NOT COMPOSITION. The parent picks a level, subjects, a city, an
// area, a mode, a budget BAND and their days. They are asked to write nothing.
// "Write this for me" turns those selections into a title and a description
// through /api/parent/jobs/generate, which calls Claude server-side.
//
// IT IS AN ASSIST, NOT A GATE. The title and description are ordinary editable
// fields. A parent who would rather type their own never touches Generate, a
// parent who presses it can rewrite every word, and nothing posts that they
// have not seen. If the API is unconfigured or fails, the server composes the
// same two fields from the selections and says so quietly -- a generation
// problem must never be the reason somebody cannot post a job.
//
// Subjects are taxonomy_master ids throughout; no free-text subject ever
// leaves this form. Levels that are leaves in their own right (Test
// Preparations, Sports & Games, Holy Quran) have no subject step.
//
// The draft survives a trip through sign-in: sessionStorage holds a draft
// only, never login or role state.

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
  budgetMin: string
  budgetMax: string
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
  budgetMin: '',
  budgetMax: '',
  schedule: '',
  description: '',
  childId: '',
}

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'

const LABEL = 'text-[11px] font-bold uppercase tracking-wide text-gray-500'

/**
 * For controls whose first option already says what they are.
 *
 * "CITY" above a select reading "Choose a city" is the same word twice, and
 * six of them stacked is most of the visual weight of step 2. The label stays
 * in the accessibility tree -- a screen reader still hears it, and it is what
 * a form control needs to be announced at all -- it just stops being drawn.
 * Title and Description keep their visible labels: an empty text box with a
 * placeholder is not self-describing once somebody has typed in it.
 */
const SR_ONLY = 'sr-only'

/**
 * Days and times, as choices rather than a text box.
 *
 * The old field was free text with a placeholder ("Mon/Wed/Fri, evenings"),
 * which is a small essay question in a form that is otherwise all taps -- and
 * whatever a parent typed there went into the generated copy verbatim.
 */
const DAY_OPTIONS = ['Weekdays', 'Weekends', 'Every day'] as const
const TIME_OPTIONS = ['Mornings', 'Afternoons', 'Evenings'] as const

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

  const [days, setDays] = useState('')
  const [times, setTimes] = useState('')

  const [writing, setWriting] = useState(false)
  const [wroteItOurselves, setWroteItOurselves] = useState(false)

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

  // The two schedule choices are one stored string. Kept in sync one way only
  // -- an edited job's existing schedule text is shown as-is below rather than
  // reverse-parsed into chips, because "Mon/Wed/Fri" does not map onto them
  // and guessing would quietly change what the parent wrote.
  useEffect(() => {
    const joined = [days, times].filter(Boolean).join(', ')
    if (joined) setV((p) => ({ ...p, schedule: joined }))
  }, [days, times])

  const set = <K extends keyof JobFormValues>(k: K, value: JobFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }))

  const areas = v.city ? (CITY_AREAS[v.city] ?? []) : []
  const band = useMemo(() => bandFor(v.budgetMin, v.budgetMax), [v.budgetMin, v.budgetMax])

  const hasSelection = !!(v.category && v.level && (levelLeaf || v.subjects.length > 0))

  // ------------------------------------------------------------ generate ---
  const write = async () => {
    setWriting(true)
    setError(null)
    setWroteItOurselves(false)
    try {
      const masterIds = await resolveMasterIds(v.category, v.level, levelLeaf ? [] : v.subjects)

      const res = await fetch('/api/parent/jobs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterIds,
          level: v.level,
          city: v.city,
          area: v.area,
          teachingMode: v.teachingMode,
          budgetMin: v.budgetMin || null,
          budgetMax: v.budgetMax || null,
          schedule: v.schedule,
        }),
      })

      const json = (await res.json()) as {
        title?: string
        description?: string
        source?: string
        error?: string
      }

      if (!res.ok) {
        setError(json.error ?? 'Could not write that just now. You can still type your own.')
        return
      }

      setV((p) => ({ ...p, title: json.title ?? p.title, description: json.description ?? p.description }))
      setWroteItOurselves(json.source === 'composed')
    } catch {
      setError('Could not write that just now. You can still type your own.')
    } finally {
      setWriting(false)
    }
  }

  // -------------------------------------------------------------- submit ---
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const masterIds = await resolveMasterIds(v.category, v.level, levelLeaf ? [] : v.subjects)
      if (masterIds.length === 0) {
        throw new Error('Choose a level, a grade and at least one subject.')
      }

      const payload = {
        jobId: v.jobId,
        title: v.title,
        masterIds,
        classLevel: v.level || v.classLevel,
        city: v.city,
        area: v.area,
        teachingMode: v.teachingMode,
        budgetMin: v.budgetMin || null,
        budgetMax: v.budgetMax || null,
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
        // The draft is kept whatever the refusal was, so nothing chosen is
        // lost -- including when the member goes off to upgrade and comes back.
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
      {/* ONE card. The steps below are dividers inside it, not boxes of their
          own: this is a single short task and it should look like one. */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {/* ---------------------------------------------------- 1. subject */}
        <Step n={1} title="What do you need taught?">
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

          {children.length > 0 && (
            <label className="block space-y-1">
              <span className={LABEL}>For which child? (optional, never shown publicly)</span>
              <select
                value={v.childId}
                onChange={(e) => set('childId', e.target.value)}
                className={FIELD}
              >
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
        </Step>

        {/* ------------------------------------------------ 2. where & when */}
        <Step n={2} title="Where, how and when">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className={SR_ONLY}>City</span>
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
              <span className={SR_ONLY}>Area</span>
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
              <span className={SR_ONLY}>Mode</span>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              {/* The same five bands as /browse/tuitions, so what a parent
                  picks here is exactly what a tutor filters by there. */}
              <span className={SR_ONLY}>Monthly budget</span>
              <select
                value={band}
                onChange={(e) => {
                  const r = bandRange(e.target.value)
                  setV((p) => ({ ...p, budgetMin: r.min, budgetMax: r.max }))
                }}
                className={FIELD}
              >
                {BUDGET_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={SR_ONLY}>Days</span>
              <select value={days} onChange={(e) => setDays(e.target.value)} className={FIELD}>
                <option value="">Any days</option>
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={SR_ONLY}>Times</span>
              <select value={times} onChange={(e) => setTimes(e.target.value)} className={FIELD}>
                <option value="">Any time</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>

          {mode === 'edit' && v.schedule && !days && !times && (
            <p className="text-[11px] text-gray-500">
              Currently: {v.schedule}. Choosing days or times above replaces it.
            </p>
          )}
        </Step>

        {/* --------------------------------------------------- 3. the words */}
        <Step n={3} title="Your advert" last>
          <div className="flex flex-col gap-2 rounded-xl bg-tm-bg p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-relaxed text-slate-700">
              {hasSelection
                ? 'We can write this from what you have chosen. You can change every word after.'
                : 'Choose a level and subject above, then we can write this for you.'}
            </p>
            <button
              type="button"
              onClick={write}
              disabled={writing || !hasSelection}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover disabled:bg-gray-300"
            >
              {writing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Sparkles size={14} aria-hidden />
              )}
              {writing ? 'Writing…' : 'Write this for me'}
            </button>
          </div>

          {/* Said quietly and truthfully. A composed fallback presented as a
              generation is a small lie that costs trust the first time
              somebody notices the difference in tone. */}
          {wroteItOurselves && (
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
              <Info size={13} className="mt-px shrink-0" aria-hidden />
              We put this together from your choices. Edit it to sound like you.
            </p>
          )}

          <label className="block space-y-1">
            <span className={LABEL}>Title</span>
            <input
              value={v.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. O Level Physics tutor needed in DHA Phase 5"
              className={FIELD}
            />
          </label>

          <label className="block space-y-1">
            <span className={LABEL}>Description</span>
            <textarea
              value={v.description}
              onChange={(e) => set('description', e.target.value)}
              rows={6}
              placeholder="What you are hoping for, in your own words."
              className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs leading-relaxed outline-none focus:border-tm-red"
            />
          </label>
        </Step>
      </div>

      {error && (
        <p className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {/* Sticky on mobile: the primary action must be reachable without
          scrolling back through the whole card. */}
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

/**
 * A step inside the one card.
 *
 * A number and a hairline, not a border and a shadow. The distinction is the
 * whole point of this pass: these are parts of one task, and anything that
 * gives them their own edges makes them look independently managed.
 */
function Step({
  n,
  title,
  children,
  last = false,
}: {
  n: number
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <section className={`space-y-3 p-4 sm:p-5 ${last ? '' : 'border-b border-gray-100'}`}>
      <h2 className="flex items-center gap-2 text-sm font-black text-tm-navy">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tm-tint-navy text-[10px] font-black text-tm-navy"
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}
