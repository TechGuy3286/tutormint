'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Loader2, Info, ShieldCheck, Phone, UserRound } from 'lucide-react'

import { submitSignal } from '@/lib/submit'
import TaxonomySelector from '@/components/TaxonomySelector'
import WhereHowWhen from '@/components/forms/WhereHowWhen'
import { isLevelLeaf, resolveMasterIds, selectionForMasterIds } from '@/lib/taxonomy'
import { CITY_AREAS } from '@/lib/locations'
import { GENDER_PREFS } from '@/lib/genderPref'
import { bandFor, bandRange } from '@/lib/feeBands'
import { takeDraft, saveDraft } from '@/components/AuthGateModal'

// THE ONE post-a-tuition form (owner, 11 Sep 2026). The parent's post-a-job form
// and /admin/jobs/new were near-duplicate copies that had already drifted (two
// step titles, two "composed" notes, two submit labels); this is their single
// implementation so a change to a shared field lands in both at once.
//
// The parent version is the reference: layout and copy here are the parent's.
// The differences between the two flows are PROPS, not a second form:
//   * `children`      — the parent's "For which child?" selector (parent only)
//   * `mode`/`initial`— edit mode with the masterId reverse-lookup (parent only)
//   * `useDraft`      — the sign-in draft round-trip (parent only)
//   * `teamBanner`    — the "Posted by TutorMint" banner (admin only)
//   * `adminExtras`   — the ORIGIN select + parent-contact block (admin only)
//   * `onSubmit`      — the parent's gated PATCH/POST, or the admin's plain POST
// Everything else — the taxonomy cascade, "Write this for me", where/how/when,
// the gender preference, title and description — is one implementation.

export type PostTuitionValues = {
  jobId?: string
  /** Stored taxonomy_master ids, resolved back into the cascade on mount (edit). */
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
  /** Optional preferred tutor gender ('' = no preference). */
  genderPreference: string
  /** Parent-only. */
  childId: string
  /** Admin-only. */
  origin: string
  contactName: string
  contactPhone: string
}

/** What a wrapper's onSubmit receives — the resolved, ready-to-send fields. */
export type PostTuitionPayload = {
  jobId?: string
  title: string
  masterIds: number[]
  classLevel: string
  city: string
  area: string
  teachingMode: string
  budgetMin: string | null
  budgetMax: string | null
  schedule: string
  description: string
  genderPreference: string | null
  childId: string | null
  origin: string | null
  contactName: string | null
  contactPhone: string | null
}

export type PostTuitionResult = { ok: true } | { ok: false; error?: string; gated?: boolean }

const EMPTY: PostTuitionValues = {
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
  genderPreference: '',
  childId: '',
  origin: '',
  contactName: '',
  contactPhone: '',
}

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'
const LABEL = 'text-[11px] font-bold uppercase tracking-wide text-gray-500'

const ORIGINS = [
  { value: '', label: 'Not specified' },
  { value: 'support', label: 'Support request' },
  { value: 'referral', label: 'Referral' },
  { value: 'external', label: 'External / off-platform' },
] as const

export default function PostTuitionForm({
  children = [],
  initial,
  mode = 'create',
  useDraft = false,
  teamBanner = false,
  adminExtras = false,
  submitLabel,
  busyLabel,
  onSubmit,
}: {
  children?: { id: string; name: string; class_level: string | null }[]
  initial?: Partial<PostTuitionValues>
  mode?: 'create' | 'edit'
  useDraft?: boolean
  teamBanner?: boolean
  adminExtras?: boolean
  submitLabel: string
  busyLabel: string
  onSubmit: (payload: PostTuitionPayload) => Promise<PostTuitionResult>
}) {
  const [v, setV] = useState<PostTuitionValues>({ ...EMPTY, ...initial })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [levelLeaf, setLevelLeaf] = useState(false)

  const [days, setDays] = useState('')
  const [times, setTimes] = useState('')

  const [writing, setWriting] = useState(false)
  const [wroteItOurselves, setWroteItOurselves] = useState(false)

  // Editing waits for the reverse lookup before the cascade renders, otherwise
  // TaxonomySelector mounts empty and selects the first category for us —
  // overwriting the job's real subjects.
  const [ready, setReady] = useState(mode !== 'edit' || !initial?.masterIds?.length)

  // A draft saved before sign-in comes back here (parent create only).
  useEffect(() => {
    if (!useDraft || mode !== 'create') return
    const draft = takeDraft<PostTuitionValues>('post')
    if (draft) setV({ ...EMPTY, ...draft })
  }, [useDraft, mode])

  // Pre-select what the job already teaches (edit).
  useEffect(() => {
    const ids = initial?.masterIds
    if (mode !== 'edit' || !ids || ids.length === 0) return
    let cancelled = false
    selectionForMasterIds(ids)
      .then((sel) => {
        if (cancelled) return
        setV((prev) => ({ ...prev, category: sel.category, level: sel.level, subjects: sel.subjects }))
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

  // The two schedule choices are one stored string, synced one way only.
  useEffect(() => {
    const joined = [days, times].filter(Boolean).join(', ')
    if (joined) setV((p) => ({ ...p, schedule: joined }))
  }, [days, times])

  const set = <K extends keyof PostTuitionValues>(k: K, value: PostTuitionValues[K]) =>
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
        signal: submitSignal(),
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
      const json = (await res.json()) as { title?: string; description?: string; source?: string; error?: string }
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

      const r = await onSubmit({
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
        genderPreference: v.genderPreference || null,
        childId: v.childId || null,
        origin: v.origin || null,
        contactName: v.contactName || null,
        contactPhone: v.contactPhone || null,
      })

      if (!r.ok) {
        // Keep the draft whatever the refusal was, so nothing chosen is lost —
        // including when a parent goes off to upgrade and comes back.
        if (useDraft) saveDraft('post', v)
        // A gate has already been explained by the sheet; a red line repeating
        // it reads as a second, different problem.
        if (!r.gated) setError(r.error ?? 'Could not post the tuition.')
        setBusy(false)
        return
      }
      // Success: onSubmit performs the toast and the redirect.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the tuition.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {teamBanner && (
        <p className="flex items-start gap-2 rounded-2xl border border-tm-navy/20 bg-tm-tint-navy p-3 text-[11px] leading-relaxed text-tm-navy">
          <ShieldCheck size={14} className="mt-px shrink-0" aria-hidden />
          This tuition is posted on the official TutorMint team account and is marked{' '}
          <strong>&ldquo;Posted by TutorMint&rdquo;</strong> everywhere it appears. Applications,
          messages and hiring run through the ordinary parent flow on that account.
        </p>
      )}

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
              allowSelectAll={false}
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
        </Step>

        {/* ------------------------------------------------ 2. where & when */}
        <Step n={2} title="Where, how and when">
          {/* The same five budget bands as /browse/tuitions, so what a parent
              picks here is exactly what a tutor filters by there. */}
          <WhereHowWhen
            city={v.city}
            area={v.area}
            mode={v.teachingMode}
            band={band}
            days={days}
            times={times}
            areas={areas}
            onCity={(x) => setV((p) => ({ ...p, city: x, area: '' }))}
            onArea={(x) => set('area', x)}
            onMode={(x) => set('teachingMode', x)}
            onBand={(x) => {
              const r = bandRange(x)
              setV((p) => ({ ...p, budgetMin: r.min, budgetMax: r.max }))
            }}
            onDays={setDays}
            onTimes={setTimes}
          />

          {/* Optional tutor-gender preference. Never required; the job stays
              visible to everyone and only Apply is gated to a matching tutor. */}
          <label className="block space-y-1">
            <span className={`${LABEL} flex items-center gap-1.5`}>
              <UserRound size={12} aria-hidden />
              Preferred tutor gender (optional)
            </span>
            <select
              value={v.genderPreference}
              onChange={(e) => set('genderPreference', e.target.value)}
              className={FIELD}
            >
              {GENDER_PREFS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>

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
              generation is a small lie that costs trust the first time somebody
              notices the difference in tone. */}
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

          {adminExtras && (
            <>
              <label className="block space-y-1">
                <span className={LABEL}>Origin (for the audit trail)</span>
                <select value={v.origin} onChange={(e) => set('origin', e.target.value)} className={FIELD}>
                  {ORIGINS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* The real parent's contact (optional). For a seeded tuition whose
                  parent has no account: shown OPENLY to signed-in tutors on the
                  job page so they can reach the parent directly. Never to another
                  parent, never indexed, never in the sitemap or structured data. */}
              <div className="space-y-3 rounded-xl border border-tm-green-deep/25 bg-tm-tint-green p-3">
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-700">
                  <Phone size={13} className="mt-px shrink-0 text-tm-green-deep" aria-hidden />
                  <span>
                    <strong>Parent contact (optional).</strong> If you enter these, tutors can
                    contact the parent directly from the job page — no application needed. Shown only
                    to signed-in tutors; never to other parents, and never indexed.
                  </span>
                </p>
                <label className="block space-y-1">
                  <span className={LABEL}>Parent name</span>
                  <input
                    value={v.contactName}
                    onChange={(e) => set('contactName', e.target.value)}
                    placeholder="e.g. Mrs. Khan"
                    className={FIELD}
                  />
                </label>
                <label className="block space-y-1">
                  <span className={LABEL}>Contact number</span>
                  <input
                    value={v.contactPhone}
                    onChange={(e) => set('contactPhone', e.target.value)}
                    placeholder="0300 1234567"
                    inputMode="tel"
                    className={FIELD}
                  />
                </label>
              </div>
            </>
          )}
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
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * A step inside the one card. A number and a hairline, not a border and a
 * shadow — these are parts of one task, and edges of their own make them look
 * independently managed.
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
