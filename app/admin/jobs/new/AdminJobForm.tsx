'use client'

import { submitSignal } from '@/lib/submit'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, Info, ShieldCheck, Phone } from 'lucide-react'
import TaxonomySelector from '@/components/TaxonomySelector'
import { useToast } from '@/components/ui/Toast'
import { isLevelLeaf, resolveMasterIds } from '@/lib/taxonomy'
import { CITIES, CITY_AREAS, TEACHING_MODES } from '@/lib/locations'
import { BUDGET_BANDS, bandFor, bandRange } from '@/lib/feeBands'
import { teachingMode } from '@/lib/display'

// Post a tuition on the team-operated TutorMint account (owner, 9 Sep 2026).
//
// The SAME job form as a parent's: the same taxonomy cascade, the same city /
// area / mode / budget-band fields, and the SAME "Write this for me" call
// (/api/parent/jobs/generate is account-agnostic — it only needs the selections)
// so there is one job shape, not two. What differs is only what an admin flow
// must: no verification gate or quota (a team post carries the platform's own
// vetting), no child selector, an ORIGIN field for the audit trail, and a plain
// POST to /api/admin/jobs/create rather than the parent's gated fetch.

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'
const LABEL = 'text-[11px] font-bold uppercase tracking-wide text-gray-500'
const SR_ONLY = 'sr-only'

const DAY_OPTIONS = ['Weekdays', 'Weekends', 'Every day'] as const
const TIME_OPTIONS = ['Mornings', 'Afternoons', 'Evenings'] as const

const ORIGINS = [
  { value: '', label: 'Not specified' },
  { value: 'support', label: 'Support request' },
  { value: 'referral', label: 'Referral' },
  { value: 'external', label: 'External / off-platform' },
] as const

type V = {
  category: string
  level: string
  subjects: string[]
  city: string
  area: string
  teachingMode: string
  budgetMin: string
  budgetMax: string
  schedule: string
  title: string
  description: string
  origin: string
  contactName: string
  contactPhone: string
}

const EMPTY: V = {
  category: '',
  level: '',
  subjects: [],
  city: '',
  area: '',
  teachingMode: '',
  budgetMin: '',
  budgetMax: '',
  schedule: '',
  title: '',
  description: '',
  origin: '',
  contactName: '',
  contactPhone: '',
}

export default function AdminJobForm() {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<V>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [levelLeaf, setLevelLeaf] = useState(false)
  const [days, setDays] = useState('')
  const [times, setTimes] = useState('')
  const [writing, setWriting] = useState(false)
  const [composed, setComposed] = useState(false)

  useEffect(() => {
    if (!v.category || !v.level) {
      setLevelLeaf(false)
      return
    }
    isLevelLeaf(v.category, v.level).then(setLevelLeaf).catch(() => setLevelLeaf(false))
  }, [v.category, v.level])

  useEffect(() => {
    const joined = [days, times].filter(Boolean).join(', ')
    if (joined) setV((p) => ({ ...p, schedule: joined }))
  }, [days, times])

  const set = <K extends keyof V>(k: K, value: V[K]) => setV((prev) => ({ ...prev, [k]: value }))

  const areas = v.city ? (CITY_AREAS[v.city] ?? []) : []
  const band = useMemo(() => bandFor(v.budgetMin, v.budgetMax), [v.budgetMin, v.budgetMax])
  const hasSelection = !!(v.category && v.level && (levelLeaf || v.subjects.length > 0))

  const write = async () => {
    setWriting(true)
    setError(null)
    setComposed(false)
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
      setComposed(json.source === 'composed')
    } catch {
      setError('Could not write that just now. You can still type your own.')
    } finally {
      setWriting(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const masterIds = await resolveMasterIds(v.category, v.level, levelLeaf ? [] : v.subjects)
      if (masterIds.length === 0) throw new Error('Choose a level, a grade and at least one subject.')

      const res = await fetch('/api/admin/jobs/create', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: v.title,
          masterIds,
          classLevel: v.level,
          city: v.city,
          area: v.area,
          teachingMode: v.teachingMode,
          budgetMin: v.budgetMin || null,
          budgetMax: v.budgetMax || null,
          schedule: v.schedule,
          description: v.description,
          origin: v.origin || null,
          contactName: v.contactName || null,
          contactPhone: v.contactPhone || null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not post the tuition.')
        toast.error(json.error ?? 'Could not post the tuition.')
        setBusy(false)
        return
      }
      toast.success('Team tuition posted.')
      // Land on the admin detail for the new job, where applications are worked.
      router.push(json.id ? `/admin/jobs/${json.id}` : '/admin/jobs')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the tuition.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl border border-tm-navy/20 bg-tm-tint-navy p-3 text-[11px] leading-relaxed text-tm-navy">
        <ShieldCheck size={14} className="mt-px shrink-0" aria-hidden />
        This tuition is posted on the official TutorMint team account and is marked{' '}
        <strong>&ldquo;Posted by TutorMint&rdquo;</strong> everywhere it appears. Applications,
        messages and hiring run through the ordinary parent flow on that account.
      </p>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <Step n={1} title="What is needed taught?">
          <TaxonomySelector
            selectedLevel={v.category}
            setSelectedLevel={(x) => setV((p) => ({ ...p, category: x, level: '', subjects: [] }))}
            selectedGrade={v.level}
            setSelectedGrade={(x) => setV((p) => ({ ...p, level: x, subjects: [] }))}
            selectedSubjects={v.subjects}
            setSelectedSubjects={(x) => set('subjects', x)}
            allowSelectAll={false}
          />
          {levelLeaf && (
            <p className="rounded-xl bg-tm-bg p-3 text-[11px] text-gray-500">
              {v.level} is chosen on its own — there is no subject list beneath it.
            </p>
          )}
        </Step>

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
        </Step>

        <Step n={3} title="The advert" last>
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
              {writing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
              {writing ? 'Writing…' : 'Write this for me'}
            </button>
          </div>

          {composed && (
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
              <Info size={13} className="mt-px shrink-0" aria-hidden />
              We put this together from the choices. Edit it before posting.
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
              placeholder="What the tuition is for, plainly."
              className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs leading-relaxed outline-none focus:border-tm-red"
            />
          </label>

          <label className="block space-y-1">
            <span className={LABEL}>Origin (for the audit trail)</span>
            <select value={v.origin} onChange={(e) => set('origin', e.target.value)} className={FIELD}>
              {ORIGINS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* The real parent's contact (optional). For a seeded tuition whose
              parent has no account: shown OPENLY to signed-in tutors on the job
              page so they can reach the parent directly. Never shown to another
              parent, never indexed, never in the sitemap or structured data. */}
          <div className="space-y-3 rounded-xl border border-tm-green-deep/25 bg-tm-tint-green p-3">
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-700">
              <Phone size={13} className="mt-px shrink-0 text-tm-green-deep" aria-hidden />
              <span>
                <strong>Parent contact (optional).</strong> If you enter these, tutors can contact
                the parent directly from the job page — no application needed. Shown only to
                signed-in tutors; never to other parents, and never indexed.
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
        </Step>
      </div>

      {error && (
        <p className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:bg-gray-300 sm:w-auto"
        >
          {busy ? 'Posting…' : 'Post team tuition'}
        </button>
      </div>
    </div>
  )
}

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
