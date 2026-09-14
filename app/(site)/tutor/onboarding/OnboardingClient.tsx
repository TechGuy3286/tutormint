'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, ImageIcon, Check, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { submitSignal, UPLOAD_TIMEOUT_MS } from '@/lib/submit'
import type { OnboardingFacets, Facet, SubjectFacet, FeeFacet } from '@/lib/openJobCounts'
import {
  L,
  EXPERIENCE_BANDS,
  composeHeadline,
  composeBio,
  type Bi,
  type OnboardingAnswers,
} from '@/lib/onboarding/copy'

// The tap-only, bilingual onboarding flow. Nothing is typed except the optional
// "Other"/"More" searches; nothing is read (labels are two or three words). One
// question per screen, a fixed live-count header, progress dots and a back
// arrow. Designed for 360px first. See lib/onboarding/copy.ts for every label
// and the tagline/bio composer, and lib/openJobCounts.ts for the counts.

type Counts = { national: number; city: number | null; area: number | null; subjects: number | null; level: number | null }

const STEP_KEYS = ['city', 'area', 'subjects', 'level', 'gender', 'experience', 'fee', 'photo', 'selfie', 'review'] as const
type StepKey = (typeof STEP_KEYS)[number]

// A bilingual label: English on top, Urdu under, smaller.
function Label({ bi, className = '' }: { bi: Bi; className?: string }) {
  return (
    <span className={`flex flex-col leading-tight ${className}`}>
      <span>{bi.en}</span>
      <span className="text-[0.8em] font-normal text-gray-500" lang="ur" dir="rtl">
        {bi.ur}
      </span>
    </span>
  )
}

function Chip({
  label,
  selected,
  onClick,
  count,
}: {
  label: string
  selected: boolean
  onClick: () => void
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors ${
        selected
          ? 'border-tm-navy bg-tm-navy text-white'
          : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
      }`}
    >
      {selected && <Check size={14} aria-hidden />}
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={`text-[10px] font-black ${selected ? 'text-white/80' : 'text-gray-500'}`}>{count}</span>
      )}
    </button>
  )
}

export default function OnboardingClient({ facets, seed }: { facets: OnboardingFacets; seed: string }) {
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])

  const [stepIndex, setStepIndex] = useState(0)
  const step: StepKey = STEP_KEYS[stepIndex]

  const [city, setCity] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  const [subjectSlugs, setSubjectSlugs] = useState<string[]>([])
  const [levelSlugs, setLevelSlugs] = useState<string[]>([])
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [expBand, setExpBand] = useState<string | null>(null)
  const [expYears, setExpYears] = useState<number | null>(null)
  const [fee, setFee] = useState<FeeFacet | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [selfieDone, setSelfieDone] = useState(false)

  const [counts, setCounts] = useState<Counts>({ national: facets.national, city: null, area: null, subjects: null, level: null })
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)

  // Review card.
  const [headline, setHeadline] = useState('')
  const [bio, setBio] = useState('')
  const [editing, setEditing] = useState(false)

  const subjectName = useMemo(() => new Map(facets.subjects.map((s) => [s.slug, s.name])), [facets.subjects])
  const levelName = useMemo(() => new Map(facets.levels.map((l) => [l.slug, l.name])), [facets.levels])

  // Recompute the counter for the current selection.
  async function refreshCounts(next: { city?: string | null; area?: string | null; subjectSlugs?: string[]; levelSlugs?: string[] }) {
    const payload = {
      city: next.city ?? city,
      area: next.area ?? area,
      subjectSlugs: next.subjectSlugs ?? subjectSlugs,
      levelSlugs: next.levelSlugs ?? levelSlugs,
    }
    try {
      const res = await fetch('/api/onboarding/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) setCounts(await res.json())
    } catch {
      /* leave the last count; the header never blocks the flow */
    }
  }

  const answers: OnboardingAnswers = {
    city,
    area,
    subjectNames: subjectSlugs.map((s) => subjectName.get(s) ?? s),
    levelNames: levelSlugs.map((s) => levelName.get(s) ?? s),
    experienceBand: expBand,
  }

  // ------------------------------------------------------------- counter ---
  // Which scope is the narrowest chosen, and its next-broader fallback. The
  // floor rule: never show a lonely number below 3 — always a broader fallback.
  const counterView = (): { primary: { n: number; bi: Bi }; fallback?: { n: number; bi: Bi } } => {
    const inCity: Bi = { en: `in ${city}`, ur: `${city} میں` }
    const inArea: Bi = { en: `in ${area}`, ur: `${area} میں` }
    const matching: Bi = { en: 'matching you', ur: 'آپ کے لیے' }
    const national: Bi = { en: L.acrossPakistan.en, ur: L.acrossPakistan.ur }

    const nat = { n: counts.national, bi: national }
    const withFloor = (primary: { n: number; bi: Bi }, chain: { n: number | null; bi: Bi }[]) => {
      if (primary.n >= 3) return { primary }
      const fb = chain.find((c) => c.n != null) as { n: number; bi: Bi } | undefined
      return fb ? { primary, fallback: fb } : { primary }
    }

    if (levelSlugs.length > 0 && counts.level != null) {
      return withFloor({ n: counts.level, bi: matching }, [
        { n: counts.subjects, bi: matching },
        { n: counts.area, bi: inArea },
        { n: counts.city, bi: inCity },
        nat,
      ])
    }
    if (subjectSlugs.length > 0 && counts.subjects != null) {
      return withFloor({ n: counts.subjects, bi: matching }, [
        { n: counts.area, bi: inArea },
        { n: counts.city, bi: inCity },
        nat,
      ])
    }
    if (area && counts.area != null) {
      return withFloor({ n: counts.area, bi: inArea }, [{ n: counts.city, bi: inCity }, nat])
    }
    if (city && counts.city != null) {
      return withFloor({ n: counts.city, bi: inCity }, [nat])
    }
    return { primary: { n: counts.national, bi: { en: L.open.en, ur: L.open.ur } } }
  }

  // ------------------------------------------------------- step gating ---
  const canProceed = (): boolean => {
    switch (step) {
      case 'city': return !!city
      case 'area': return !!area
      case 'subjects': return subjectSlugs.length > 0
      case 'level': return levelSlugs.length > 0
      case 'gender': return !!gender
      case 'experience': return !!expBand
      case 'fee': return !!fee
      case 'photo': return !!avatarUrl
      case 'selfie': return selfieDone
      case 'review': return true
    }
  }
  // Skip appears only once the subjects step (index 2) has been passed.
  const canSkip = stepIndex > 2 && step !== 'review'

  function goNext() {
    setSearch('')
    setMoreOpen(false)
    if (stepIndex === STEP_KEYS.indexOf('selfie')) {
      // Entering review: compose the headline and bio from the answers.
      setHeadline(composeHeadline(answers))
      setBio(composeBio(answers, seed))
    }
    setStepIndex((i) => Math.min(i + 1, STEP_KEYS.length - 1))
  }
  function goBack() {
    setSearch('')
    setMoreOpen(false)
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  // ------------------------------------------------------------- uploads ---
  async function uploadPhoto(file: File) {
    setBusy(true)
    try {
      const path = `${seed}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (error) throw new Error(error.message)
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
      toast.success('Photo added.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the photo.')
    } finally {
      setBusy(false)
    }
  }
  async function uploadSelfie(file: File) {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('kind', 'selfie')
      fd.append('file', file)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd, signal: submitSignal(UPLOAD_TIMEOUT_MS) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Upload failed.')
      setSelfieDone(true)
      toast.success('Selfie added.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the selfie.')
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------- finish ---
  async function finish() {
    setBusy(true)
    try {
      const res = await fetch('/api/tutor/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          area,
          gender,
          experienceYears: expYears,
          feeRep: fee?.rep ?? null,
          subjectSlugs,
          levelSlugs,
          headline,
          bio,
          avatarUrl,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Could not save.')
      toast.success('Your profile is set up.')
      router.push(json.next ?? '/browse/tuitions')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save your profile.')
      setBusy(false)
    }
  }

  const view = counterView()

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28">
      {/* keyframe for the counter bump */}
      <style>{`@keyframes tmbump{0%{transform:scale(1)}30%{transform:scale(1.12)}100%{transform:scale(1)}}`}</style>

      {/* -------------------------------------------------------- header --- */}
      <header className="sticky top-0 z-10 -mx-4 bg-tm-bg px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0}
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-tm-navy disabled:opacity-30"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p key={`${view.primary.n}-${view.primary.bi.en}`} className="text-3xl font-black text-tm-navy" style={{ animation: 'tmbump .35s ease-out' }}>
              {view.primary.n} <span className="text-base font-bold text-gray-500">{view.primary.bi.en}</span>
            </p>
            <p className="text-[11px] text-gray-500" lang="ur" dir="rtl">
              {view.primary.bi.ur} {view.primary.n}
            </p>
            {view.fallback && (
              <p className="mt-0.5 text-[11px] font-semibold text-gray-500">
                · {view.fallback.n} {view.fallback.bi.en}
              </p>
            )}
          </div>
          <div className="w-10 shrink-0" aria-hidden />
        </div>
        {/* progress dots */}
        <div className="mt-3 flex justify-center gap-1.5">
          {STEP_KEYS.map((k, i) => (
            <span
              key={k}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? 'w-5 bg-tm-navy' : i < stepIndex ? 'w-1.5 bg-tm-navy/50' : 'w-1.5 bg-gray-300'
              }`}
            />
          ))}
        </div>
      </header>

      {/* --------------------------------------------------------- body --- */}
      <main className="flex-1 pt-6">
        <h1 className="mb-5 text-center text-xl font-black text-tm-navy">
          <Label bi={L[step === 'review' ? 'review' : step]} />
        </h1>

        {step === 'city' && (
          <ChipGroup
            options={facets.cities}
            selected={city ? [city] : []}
            onToggle={(name) => {
              const next = city === name ? null : name
              setCity(next); setArea(null)
              refreshCounts({ city: next, area: null })
            }}
            search={search}
            setSearch={setSearch}
            moreOpen={moreOpen}
            setMoreOpen={setMoreOpen}
            all={facets.cities}
          />
        )}

        {step === 'area' && (
          <ChipGroup
            options={(city && facets.areasByCity[city]) || []}
            selected={area ? [area] : []}
            onToggle={(name) => {
              const next = area === name ? null : name
              setArea(next)
              refreshCounts({ area: next })
            }}
            search={search}
            setSearch={setSearch}
            moreOpen={moreOpen}
            setMoreOpen={setMoreOpen}
            all={(city && facets.areasByCity[city]) || []}
          />
        )}

        {step === 'subjects' && (
          <SubjectGroup
            subjects={facets.subjects}
            selected={subjectSlugs}
            onToggle={(slug) => {
              const next = subjectSlugs.includes(slug) ? subjectSlugs.filter((s) => s !== slug) : [...subjectSlugs, slug]
              setSubjectSlugs(next)
              refreshCounts({ subjectSlugs: next })
            }}
            search={search}
            setSearch={setSearch}
            moreOpen={moreOpen}
            setMoreOpen={setMoreOpen}
          />
        )}

        {step === 'level' && (
          <div className="flex flex-wrap justify-center gap-2">
            {facets.levels.map((l) => (
              <Chip
                key={l.slug}
                label={l.name}
                count={l.count}
                selected={levelSlugs.includes(l.slug)}
                onClick={() => {
                  const next = levelSlugs.includes(l.slug) ? levelSlugs.filter((s) => s !== l.slug) : [...levelSlugs, l.slug]
                  setLevelSlugs(next)
                  refreshCounts({ levelSlugs: next })
                }}
              />
            ))}
          </div>
        )}

        {step === 'gender' && (
          <div className="grid grid-cols-2 gap-3">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                aria-pressed={gender === g}
                className={`flex min-h-[96px] flex-col items-center justify-center rounded-2xl border-2 text-lg font-black transition-colors ${
                  gender === g ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy'
                }`}
              >
                <Label bi={L[g]} className="items-center text-center" />
              </button>
            ))}
          </div>
        )}

        {step === 'experience' && (
          <div className="flex flex-wrap justify-center gap-2">
            {EXPERIENCE_BANDS.map((b) => (
              <Chip
                key={b.label}
                label={b.label}
                selected={expBand === b.label}
                onClick={() => {
                  setExpBand(b.label); setExpYears(b.years)
                }}
              />
            ))}
          </div>
        )}

        {step === 'fee' && (
          <div className="flex flex-wrap justify-center gap-2">
            {facets.feeBands.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={fee?.value === f.value}
                onClick={() => setFee(f)}
              />
            ))}
          </div>
        )}

        {step === 'photo' && (
          <PhotoStep onFile={uploadPhoto} done={!!avatarUrl} busy={busy} allowGallery />
        )}
        {step === 'selfie' && (
          <PhotoStep onFile={uploadSelfie} done={selfieDone} busy={busy} allowGallery={false} front />
        )}

        {step === 'review' && (
          <ReviewCard
            headline={headline}
            bio={bio}
            editing={editing}
            setEditing={setEditing}
            setHeadline={setHeadline}
            setBio={setBio}
          />
        )}
      </main>

      {/* ------------------------------------------------------- footer --- */}
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-md items-center gap-3">
          {canSkip && (
            <button
              type="button"
              onClick={goNext}
              className="min-h-[48px] rounded-xl px-4 text-sm font-bold text-gray-500"
            >
              <Label bi={L.skip} className="items-center" />
            </button>
          )}
          {step === 'review' ? (
            <button
              type="button"
              disabled={busy}
              onClick={finish}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-sm font-black text-white disabled:opacity-60"
            >
              <Label bi={busy ? { en: 'Saving…', ur: 'محفوظ ہو رہا ہے…' } : L.seeTuitions} className="items-center" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canProceed()}
              onClick={goNext}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
            >
              <Label bi={L.next} className="items-center" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// --- shared step pieces ------------------------------------------------------

function OtherSearch({
  all,
  onPick,
  search,
  setSearch,
}: {
  all: { name: string }[]
  onPick: (name: string) => void
  search: string
  setSearch: (s: string) => void
}) {
  const q = search.trim().toLowerCase()
  const hits = q ? all.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 20) : []
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3">
        <Search size={16} className="text-gray-500" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={L.search.en}
          aria-label={L.search.en}
          className="min-h-[44px] flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {hits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hits.map((o) => (
            <button
              key={o.name}
              type="button"
              onClick={() => onPick(o.name)}
              className="inline-flex min-h-[44px] items-center rounded-full border border-gray-200 bg-white px-4 text-sm font-bold text-tm-navy hover:border-tm-navy"
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChipGroup({
  options,
  all,
  selected,
  onToggle,
  search,
  setSearch,
  moreOpen,
  setMoreOpen,
}: {
  options: Facet[]
  all: Facet[]
  selected: string[]
  onToggle: (name: string) => void
  search: string
  setSearch: (s: string) => void
  moreOpen: boolean
  setMoreOpen: (b: boolean) => void
}) {
  // Show the demand-ordered chips; anything not shown is reachable via "Other".
  const shown = options.slice(0, 12)
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2">
        {shown.map((o) => (
          <Chip key={o.name} label={o.name} count={o.count} selected={selected.includes(o.name)} onClick={() => onToggle(o.name)} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-gray-300 px-4 text-sm font-bold text-gray-500"
        >
          <Label bi={L.other} className="items-center" />
        </button>
      </div>
      {moreOpen && <OtherSearch all={all} onPick={onToggle} search={search} setSearch={setSearch} />}
    </div>
  )
}

function SubjectGroup({
  subjects,
  selected,
  onToggle,
  search,
  setSearch,
  moreOpen,
  setMoreOpen,
}: {
  subjects: SubjectFacet[]
  selected: string[]
  onToggle: (slug: string) => void
  search: string
  setSearch: (s: string) => void
  moreOpen: boolean
  setMoreOpen: (b: boolean) => void
}) {
  const shown = subjects.slice(0, 14)
  const q = search.trim().toLowerCase()
  const hits = q ? subjects.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 24) : []
  const byS = new Map(subjects.map((s) => [s.slug, s.name]))
  return (
    <div>
      {/* Selected chips (incl. any chosen from More) stay visible as a summary. */}
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap justify-center gap-1.5">
          {selected.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => onToggle(slug)}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-tm-red px-3 text-xs font-bold text-white"
            >
              {byS.get(slug) ?? slug}
              <X size={12} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {shown.map((s) => (
          <Chip key={s.slug} label={s.name} count={s.count} selected={selected.includes(s.slug)} onClick={() => onToggle(s.slug)} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-gray-300 px-4 text-sm font-bold text-gray-500"
        >
          <Label bi={L.more} className="items-center" />
        </button>
      </div>
      {moreOpen && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3">
            <Search size={16} className="text-gray-500" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={L.search.en}
              aria-label={L.search.en}
              className="min-h-[44px] flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          {hits.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {hits.map((s) => (
                <Chip key={s.slug} label={s.name} count={s.count} selected={selected.includes(s.slug)} onClick={() => onToggle(s.slug)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PhotoStep({
  onFile,
  done,
  busy,
  allowGallery,
  front = false,
}: {
  onFile: (f: File) => void
  done: boolean
  busy: boolean
  allowGallery: boolean
  front?: boolean
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`grid h-40 w-40 place-items-center rounded-2xl border-2 ${done ? 'border-tm-green-deep bg-tm-tint-green' : 'border-dashed border-gray-300 bg-white'}`}>
        {done ? <Check size={44} className="text-tm-green-deep" /> : <Camera size={44} className="text-gray-500" />}
      </div>

      {/* One tap opens the camera directly. capture=environment (photo) /
          capture=user (selfie). Desktop ignores capture and shows a file picker. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture={front ? 'user' : 'environment'}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => cameraRef.current?.click()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-60"
      >
        <Camera size={18} aria-hidden />
        <Label bi={busy ? { en: 'Uploading…', ur: 'اپ لوڈ ہو رہا ہے…' } : L.openCamera} className="items-center" />
      </button>

      {allowGallery && (
        <>
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 disabled:opacity-60"
          >
            <ImageIcon size={16} aria-hidden />
            <Label bi={L.fromGallery} className="items-center" />
          </button>
        </>
      )}
    </div>
  )
}

function ReviewCard({
  headline,
  bio,
  editing,
  setEditing,
  setHeadline,
  setBio,
}: {
  headline: string
  bio: string
  editing: boolean
  setEditing: (b: boolean) => void
  setHeadline: (s: string) => void
  setBio: (s: string) => void
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">
          <Label bi={L.tagline} />
        </p>
        {editing ? (
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="w-full rounded-xl border border-gray-300 p-2 text-sm font-bold text-tm-navy"
          />
        ) : (
          <p className="text-base font-black text-tm-navy">{headline}</p>
        )}
      </div>
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">
          <Label bi={L.bio} />
        </p>
        {editing ? (
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-gray-300 p-2 text-sm text-slate-700"
          />
        ) : (
          <p className="text-sm leading-relaxed text-slate-700">{bio}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setEditing(!editing)}
        className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy"
      >
        <Label bi={editing ? L.looksGood : L.edit} className="items-center" />
      </button>
    </div>
  )
}
