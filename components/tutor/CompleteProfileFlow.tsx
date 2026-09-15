'use client'

import { ArrowLeft, Camera, Check, Loader2, MessageCircle, Mail, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { compressImage } from '@/lib/imageCompress'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import { EXPERIENCE_BANDS, composeHeadline, composeBio, type OnboardingAnswers } from '@/lib/onboarding/copy'
import type { OnboardingFacets } from '@/lib/openJobCounts'
import type { Identity } from '@/lib/identity'
import SubjectPicker from '@/components/tutor/SubjectPicker'
import VideoUpload from '@/components/tutor/VideoUpload'
import IdentityCard from '@/components/identity/IdentityCard'
import TutorVerifyGate from '@/components/upgrade/TutorVerifyGate'
import {
  FLOW_ORDER,
  BLOCKER_STEPS,
  stepDone,
  firstMissingStep,
  nextMissingAfter,
  isListed,
  toListingFacts,
  type FlowFacts,
  type FlowStepKey,
} from '@/lib/tutorFlow'
import { directoryBlockers, listingFixes } from '@/lib/tutorListingStatus'

// One tap-tap flow for every tutor (PR 4 §1). It replaces the long step-tab form
// at /tutor/complete-profile and unifies with /tutor/onboarding. It computes what
// is missing from the same facts the completion widget and directoryBlockers use,
// opens at the first gap (or ?step=<key>), skips filled steps, and saves every
// answer immediately — so leaving mid-flow loses nothing. Blockers first; a
// blocker cannot be skipped. The final screen says "You're listed" only when
// directoryBlockers is empty.
//
// NOTE: no browser drove this. The gap ORDER and the per-step done tests are
// unit-tested in lib/tutorFlow; the screens themselves are not exercised here.

const TITLES: Record<FlowStepKey, string> = {
  city: 'Which city do you teach in?',
  subjects: 'What subjects do you teach?',
  mobile: 'Verify your mobile number',
  verify: 'Get verified',
  jobtype: 'What kind of work do you want?',
  area: 'Which area?',
  name: 'Your full name',
  gender: 'You are',
  photo: 'Add your photo',
  tagline: 'Your professional tagline',
  bio: 'A short about-you',
  experience: 'Years of experience',
  fee: 'Your expected monthly fee',
  degree: 'Your top degree',
  cnic: 'Your CNIC',
  video: 'A short introduction video',
}

type Props = { facets: OnboardingFacets | null; support: { waHref: string | null; email: string | null }; seed: string }

export default function CompleteProfileFlow({ facets, support, seed }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { titles: jobTitles } = useJobTitles()
  const { map: cityMap } = useCityAreas()

  const [facts, setFacts] = useState<FlowFacts | null>(null)
  // The tutor's actual saved subject master ids, so the subjects step preselects
  // them and a toggle EDITS the set rather than replacing it with one pick.
  const [subjectIds, setSubjectIds] = useState<number[]>([])
  const [stepKey, setStepKey] = useState<FlowStepKey | 'final' | null>(null)
  const [jobTypeDemand, setJobTypeDemand] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const deepLink = params.get('step')

  const buildFacts = useCallback(async (): Promise<{ facts: FlowFacts; subjectIds: number[] } | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login?next=/tutor/complete-profile')
      return null
    }
    const [{ data: p }, { data: tp }, subj, deg] = await Promise.all([
      supabase.from('profiles')
        .select('full_name, city, cnic_number, cnic_image_path, phone_verified_at, is_seed, is_team_account, is_banned, is_suspended')
        .eq('id', user.id).maybeSingle(),
      supabase.from('tutor_profiles')
        .select('city, area, gender, avatar_url, headline, bio, experience_years, hourly_rate_pkr, job_types, degrees, video_youtube_id, video_status, verified_fee_paid_at, under_review, verification_status, imported, claimed_at')
        .eq('id', user.id).maybeSingle(),
      supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
      supabase.from('user_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('kind', 'degree'),
    ])
    const ids = (subj.data ?? []).map((r) => r.master_id as number)
    const facts: FlowFacts = {
      fullName: (p?.full_name as string) ?? null,
      gender: (tp?.gender as string) ?? null,
      city: (tp?.city as string) ?? (p?.city as string) ?? null,
      area: (tp?.area as string) ?? null,
      avatarUrl: (tp?.avatar_url as string) ?? null,
      headline: (tp?.headline as string) ?? null,
      bio: (tp?.bio as string) ?? null,
      experienceYears: (tp?.experience_years as number | null) ?? null,
      hourlyRate: (tp?.hourly_rate_pkr as number | null) ?? null,
      jobTypes: ((tp?.job_types as string[] | null) ?? []),
      degreesCount: Array.isArray(tp?.degrees) ? tp.degrees.length : 0,
      degreeDocCount: deg.count ?? 0,
      cnicNumber: (p?.cnic_number as string) ?? null,
      cnicImagePath: (p?.cnic_image_path as string) ?? null,
      subjectCount: ids.length,
      phoneVerified: !!p?.phone_verified_at,
      feePaid: !!tp?.verified_fee_paid_at,
      videoDone: !!tp?.video_youtube_id || ((tp?.video_status as string | null) ?? 'none') !== 'none',
      isSeed: !!p?.is_seed,
      isTeamAccount: !!p?.is_team_account,
      isBanned: !!p?.is_banned,
      isSuspended: !!p?.is_suspended,
      underReview: !!tp?.under_review,
      verificationStatus: (tp?.verification_status as string) ?? null,
      imported: !!tp?.imported,
      claimedAt: (tp?.claimed_at as string) ?? null,
    }
    return { facts, subjectIds: ids }
  }, [supabase, router])

  // Initial load: build facts, open the deep-linked step or the first gap.
  useEffect(() => {
    let live = true
    void (async () => {
      const res = await buildFacts()
      if (!live || !res) return
      setFacts(res.facts)
      setSubjectIds(res.subjectIds)
      const dl = deepLink && (FLOW_ORDER as string[]).includes(deepLink) ? (deepLink as FlowStepKey) : null
      setStepKey(dl ?? firstMissingStep(res.facts) ?? 'final')
    })()
    fetch('/api/tutor/demand', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.jobTypeDemand) setJobTypeDemand(j.jobTypeDemand as Record<string, number>) })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    const res = await buildFacts()
    if (res) {
      setFacts(res.facts)
      setSubjectIds(res.subjectIds)
    }
    return res?.facts ?? null
  }, [buildFacts])

  // Advance to the next gap after the current step (skips filled), or the final
  // screen. Reloads facts first so a component-driven step (cnic, video, verify)
  // is seen as done.
  const advance = useCallback(async () => {
    setBusy(true)
    const f = (await reload()) ?? facts
    setBusy(false)
    if (!f || stepKey === 'final' || stepKey === null) return
    const next = nextMissingAfter(f, stepKey)
    setStepKey(next ?? 'final')
  }, [reload, facts, stepKey])

  const goBack = useCallback(() => {
    if (stepKey === 'final') {
      // Back from the summary → the last step in order.
      setStepKey(FLOW_ORDER[FLOW_ORDER.length - 1])
      return
    }
    if (!stepKey) return
    const i = FLOW_ORDER.indexOf(stepKey)
    if (i > 0) setStepKey(FLOW_ORDER[i - 1])
  }, [stepKey])

  // Persist onboarded_at (so the sign-in gate never loops) and leave.
  const leave = useCallback(async (to: string) => {
    setBusy(true)
    try {
      await fetch('/api/tutor/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true }),
      })
    } catch { /* leaving anyway */ }
    router.push(to)
  }, [router])

  // ---- per-field saves (immediate) -----------------------------------------
  const saveProfile = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/profile/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || 'Could not save.')
    }
  }, [])

  // A tapped answer: save, patch facts locally, advance to the next gap.
  const tapSave = useCallback(async (payload: Record<string, unknown>, patch: Partial<FlowFacts>) => {
    setBusy(true)
    try {
      await saveProfile(payload)
      const f = facts ? { ...facts, ...patch } : facts
      if (f) setFacts(f)
      setBusy(false)
      // Advance from the CURRENT step to the next gap using the patched facts.
      if (f && stepKey && stepKey !== 'final') setStepKey(nextMissingAfter(f, stepKey) ?? 'final')
    } catch (e) {
      setBusy(false)
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    }
  }, [saveProfile, facts, stepKey, toast])

  if (!facts || !stepKey) {
    return <div className="grid min-h-screen place-items-center text-xs font-bold text-gray-500">Loading…</div>
  }

  const isBlocker = stepKey !== 'final' && BLOCKER_STEPS.has(stepKey)
  const canSkip = stepKey !== 'final' && !isBlocker
  const stepIndex = stepKey === 'final' ? FLOW_ORDER.length : FLOW_ORDER.indexOf(stepKey)

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28">
      {/* header */}
      <header className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-tm-bg px-4 pb-3 pt-4">
        <button
          type="button" onClick={goBack} disabled={stepIndex <= 0}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-tm-navy disabled:opacity-30"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex gap-1">
            {FLOW_ORDER.map((k, i) => (
              <span key={k} className={`h-1.5 flex-1 rounded-full ${i < stepIndex ? 'bg-tm-navy' : i === stepIndex ? 'bg-tm-navy/60' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
        <button type="button" onClick={() => void leave('/tutor/dashboard')} disabled={busy}
          className="shrink-0 text-[11px] font-bold text-gray-500 disabled:opacity-40">
          Later
        </button>
      </header>

      <main className="flex-1 pt-6">
        {stepKey !== 'final' && (
          <h1 className="mb-5 text-center text-xl font-black text-tm-navy">{TITLES[stepKey]}</h1>
        )}

        {stepKey === 'city' && (
          <ChipRow
            options={cityOptions(facets, cityMap.cities)}
            selected={facts.city}
            onPick={(name) => void tapSave({ profile: { city: name } }, { city: name })}
          />
        )}

        {stepKey === 'subjects' && (
          // Multi-select: save the FULL set on each toggle (never replace it with
          // one pick), and advance with the Next button, not per tap.
          <SubjectPicker
            value={subjectIds}
            onChange={(ids) => {
              setSubjectIds(ids)
              void saveProfile({ subjectMasterIds: ids })
                .then(() => setFacts((fx) => (fx ? { ...fx, subjectCount: ids.length } : fx)))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save.'))
            }}
          />
        )}

        {stepKey === 'jobtype' && (
          <MultiChipRow
            options={orderedTitles(jobTitles, jobTypeDemand)}
            selected={facts.jobTypes}
            onToggle={(next) =>
              void saveProfile({ tutorProfile: { job_types: next, teaching_mode: next[0] ?? null } })
                .then(() => setFacts((f) => (f ? { ...f, jobTypes: next } : f)))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save.'))
            }
          />
        )}

        {stepKey === 'area' && (
          <ChipRow
            options={areaOptions(facets, cityMap, facts.city)}
            selected={facts.area}
            onPick={(name) => void tapSave({ tutorProfile: { area: name } }, { area: name })}
          />
        )}

        {stepKey === 'gender' && (
          <div className="grid grid-cols-2 gap-3">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g} type="button"
                onClick={() => void tapSave({ tutorProfile: { gender: g } }, { gender: g })}
                aria-pressed={facts.gender === g}
                className={`flex min-h-[96px] items-center justify-center rounded-2xl border-2 text-lg font-black capitalize ${
                  facts.gender === g ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {stepKey === 'experience' && (
          <div className="flex flex-wrap justify-center gap-2">
            {EXPERIENCE_BANDS.map((b) => (
              <Chip
                key={b.label} label={`${b.label} years`} selected={false}
                onClick={() => void tapSave({ tutorProfile: { experience_years: b.years } }, { experienceYears: b.years })}
              />
            ))}
          </div>
        )}

        {stepKey === 'mobile' && (
          <MobileStep support={support} onVerified={() => void advance()} />
        )}

        {stepKey === 'verify' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <TutorVerifyGate onClose={() => void advance()} />
          </div>
        )}

        {stepKey === 'photo' && (
          <PhotoStep
            seed={seed}
            currentUrl={facts.avatarUrl}
            onUploaded={(url) => void tapSave({ tutorProfile: { avatar_url: url } }, { avatarUrl: url })}
          />
        )}

        {stepKey === 'name' && (
          <TextStep
            initial={facts.fullName ?? ''} placeholder="Your full name"
            onNext={(v) => void tapSave({ profile: { full_name: v } }, { fullName: v })}
            busy={busy}
          />
        )}
        {stepKey === 'tagline' && (
          <TextStep
            initial={facts.headline ?? composeHeadline(answersFor(facts))} placeholder="e.g. O Level Physics specialist"
            onNext={(v) => void tapSave({ tutorProfile: { headline: v } }, { headline: v })}
            busy={busy}
          />
        )}
        {stepKey === 'bio' && (
          <TextStep
            initial={facts.bio ?? composeBio(answersFor(facts), seed)} placeholder="Two or three lines about how you teach" multiline
            onNext={(v) => void tapSave({ tutorProfile: { bio: v } }, { bio: v })}
            busy={busy}
          />
        )}
        {stepKey === 'fee' && (
          <TextStep
            initial={facts.hourlyRate != null ? String(facts.hourlyRate) : ''} placeholder="Monthly fee in PKR, e.g. 15000" numeric
            onNext={(v) => {
              const n = Number(v.replace(/[^\d]/g, ''))
              if (!n) { toast.error('Enter your expected monthly fee.'); return }
              void tapSave({ tutorProfile: { hourly_rate_pkr: n } }, { hourlyRate: n })
            }}
            busy={busy}
          />
        )}

        {stepKey === 'degree' && (
          <DegreeStep onSaved={() => void advance()} />
        )}
        {stepKey === 'cnic' && <CnicStep />}
        {stepKey === 'video' && (
          <VideoUpload initialAttempts={0} initialStatus={facts.videoDone ? 'uploaded' : 'none'} onSubmitted={() => void advance()} />
        )}

        {stepKey === 'final' && <FinalScreen facts={facts} onLeave={leave} />}
      </main>

      {/* footer */}
      {stepKey !== 'final' && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-md items-center gap-3">
            {canSkip && (
              <button type="button" onClick={() => void advance()} className="min-h-[48px] rounded-xl px-4 text-sm font-bold text-gray-500">
                Skip
              </button>
            )}
            {/* The component-driven steps advance from their own callback; the
                rest advance on this button. Blockers require the step done. */}
            {!['mobile', 'verify', 'cnic', 'video', 'degree', 'photo', 'name', 'tagline', 'bio', 'fee'].includes(stepKey) && (
              <button
                type="button" onClick={() => void advance()} disabled={busy || (isBlocker && !stepDone(facts, stepKey))}
                className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
              >
                {busy ? '…' : 'Next'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- helpers ---------------------------------------------------------------

function answersFor(f: FlowFacts): OnboardingAnswers {
  return { city: f.city, area: f.area, subjectNames: [], levelNames: [], experienceBand: null }
}

function cityOptions(facets: OnboardingFacets | null, fallback: string[]): { name: string; count?: number }[] {
  if (facets && facets.cities.length) return facets.cities.slice(0, 24)
  return fallback.map((name) => ({ name }))
}
function areaOptions(facets: OnboardingFacets | null, cityMap: ReturnType<typeof useCityAreas>['map'], city: string | null) {
  if (facets && city && facets.areasByCity[city]?.length) return facets.areasByCity[city].slice(0, 24)
  return areasForCity(cityMap, city ?? '').map((name) => ({ name }))
}
function orderedTitles(titles: string[], demand: Record<string, number>): string[] {
  return [...titles].sort((a, b) => (demand[b] ?? 0) - (demand[a] ?? 0))
}

function Chip({ label, selected, onClick, count }: { label: string; selected: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors ${
        selected ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
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

function ChipRow({ options, selected, onPick }: { options: { name: string; count?: number }[]; selected: string | null; onPick: (name: string) => void }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const shown = query ? options.filter((o) => o.name.toLowerCase().includes(query)).slice(0, 30) : options
  return (
    <div className="space-y-3">
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search"
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-tm-navy"
      />
      <div className="flex flex-wrap justify-center gap-2">
        {shown.map((o) => (
          <Chip key={o.name} label={o.name} count={o.count} selected={selected === o.name} onClick={() => onPick(o.name)} />
        ))}
      </div>
    </div>
  )
}

function MultiChipRow({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (next: string[]) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {options.map((name) => {
        const on = selected.includes(name)
        return (
          <Chip key={name} label={name} selected={on} onClick={() => onToggle(on ? selected.filter((x) => x !== name) : [...selected, name])} />
        )
      })}
    </div>
  )
}

function TextStep({ initial, placeholder, onNext, busy, multiline, numeric }: {
  initial: string; placeholder: string; onNext: (v: string) => void; busy: boolean; multiline?: boolean; numeric?: boolean
}) {
  const [v, setV] = useState(initial)
  return (
    <div className="space-y-4">
      {multiline ? (
        <textarea value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} rows={5}
          className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy" />
      ) : (
        <input value={v} inputMode={numeric ? 'numeric' : 'text'} onChange={(e) => setV(e.target.value)} placeholder={placeholder}
          className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy" />
      )}
      <button
        type="button" disabled={busy || !v.trim()} onClick={() => onNext(v.trim())}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
    </div>
  )
}

function PhotoStep({ seed, currentUrl, onUploaded }: { seed: string; currentUrl: string | null; onUploaded: (url: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(currentUrl)

  async function upload(file: File) {
    setBusy(true)
    try {
      const img = await compressImage(file)
      const path = `${seed}/${Date.now()}-${img.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from('avatars').upload(path, img, { upsert: true })
      if (error) throw new Error(error.message)
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setPreview(URL.createObjectURL(img))
      onUploaded(data.publicUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`relative grid h-40 w-40 place-items-center overflow-hidden rounded-2xl border-2 ${preview ? 'border-tm-green-deep' : 'border-dashed border-gray-300 bg-white'}`}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Your photo" className="h-full w-full object-cover" />
        ) : (
          <Camera size={40} className="text-gray-500" aria-hidden />
        )}
        {busy && <span className="absolute inset-0 grid place-items-center bg-tm-black/40"><Loader2 size={24} className="animate-spin text-white" aria-hidden /></span>}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
      <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-60">
        <Camera size={18} aria-hidden /> Open camera
      </button>
      <button type="button" disabled={busy} onClick={() => galleryRef.current?.click()}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 disabled:opacity-60">
        Choose from gallery
      </button>
    </div>
  )
}

function DegreeStep({ onSaved }: { onSaved: () => void }) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploaded, setUploaded] = useState(false)

  async function uploadCert(file: File) {
    setBusy(true)
    try {
      const img = await compressImage(file)
      const fd = new FormData()
      fd.append('kind', 'degree'); fd.append('file', img); fd.append('label', title.trim() || 'Degree certificate')
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Upload failed.')
      setUploaded(true)
      toast.success('Certificate uploaded.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!title.trim()) { toast.error('Add your degree first.'); return }
    if (!uploaded) { toast.error('Add the certificate image.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/profile/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorProfile: { degrees: [title.trim()] } }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save.')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Degree, e.g. BSc Physics — Punjab University"
        className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy" />
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCert(f) }} />
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
        className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 px-4 text-sm font-bold ${uploaded ? 'border-tm-green-deep text-tm-green-deep' : 'border-dashed border-gray-300 text-tm-navy'}`}>
        <Camera size={18} aria-hidden /> {uploaded ? 'Certificate added — retake' : 'Photograph your certificate'}
      </button>
      <p className="text-[11px] text-gray-500">Only you and our verification team can see it. Previews are watermarked.</p>
      <button type="button" disabled={busy} onClick={() => void save()}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40">
        {busy ? '…' : 'Save & continue'}
      </button>
    </div>
  )
}

function CnicStep() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/identity', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.identity) setIdentity(j.identity as Identity) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  if (!identity) return <p className="text-center text-xs text-gray-500">Loading…</p>
  return <IdentityCard identity={identity} role="tutor" />
}

function MobileStep({ support, onVerified }: { support: { waHref: string | null; email: string | null }; onVerified: () => void }) {
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function send() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', phone }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error ?? 'Could not send the code.'); if (j.retryAfterSeconds) setCooldown(j.retryAfterSeconds); return }
      setSent(true); setCooldown(60)
      toast.success('Code sent on WhatsApp.')
    } finally { setBusy(false) }
  }
  async function verify() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', phone, code: otp }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error ?? 'Could not verify.'); return }
      toast.success('Number verified.')
      onVerified()
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <p className="text-center text-[11px] leading-relaxed text-gray-500">We send a 6-digit code to your mobile on WhatsApp.</p>
      <input value={phone} inputMode="numeric" onChange={(e) => setPhone(e.target.value)} placeholder="03214567890"
        className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy" />
      <button type="button" disabled={busy || !phone || cooldown > 0} onClick={() => void send()}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40">
        {cooldown > 0 ? `Resend in ${cooldown}s` : sent ? 'Resend code' : 'Send code'}
      </button>
      {sent && (
        <>
          <input value={otp} inputMode="numeric" onChange={(e) => setOtp(e.target.value)} placeholder="000000"
            className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-center text-lg font-black tracking-widest outline-none focus:border-tm-navy" />
          <button type="button" disabled={busy || !otp} onClick={() => void verify()}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-4 text-sm font-black text-white disabled:opacity-40">
            <ShieldCheck size={16} aria-hidden /> Verify
          </button>
        </>
      )}
      {(support.waHref || support.email) && (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-bold text-tm-navy">No WhatsApp on this number?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {support.waHref && (
              <a href={support.waHref} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white">
                <MessageCircle size={14} aria-hidden /> WhatsApp us
              </a>
            )}
            {support.email && (
              <a href={`mailto:${support.email}?subject=${encodeURIComponent('Cannot verify my TutorMint mobile number')}`}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy">
                <Mail size={14} aria-hidden /> Email us
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FinalScreen({ facts, onLeave }: { facts: FlowFacts; onLeave: (to: string) => void }) {
  const listed = isListed(facts)
  const blockers = directoryBlockers(toListingFacts(facts))
  const fixes = listingFixes(blockers)
  return (
    <div className="space-y-5 pt-6 text-center">
      {listed ? (
        <>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-tm-tint-green text-tm-green-deep">
            <Check size={32} aria-hidden />
          </div>
          <h1 className="text-xl font-black text-tm-navy">You&rsquo;re listed</h1>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-gray-500">
            Parents can find you in search. A more complete profile ranks you higher.
          </p>
          <button type="button" onClick={() => onLeave('/browse/tuitions')}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-sm font-black text-white">
            See tuitions
          </button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-black text-tm-navy">Almost there</h1>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-gray-500">
            Add these to be shown to parents in search:
          </p>
          <ul className="mx-auto max-w-xs space-y-2 text-left">
            {fixes.map((f) => (
              <li key={f.href}>
                <Link href={f.href} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy">
                  {f.label}
                  <span aria-hidden className="text-tm-red">›</span>
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => onLeave('/tutor/dashboard')}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-bold text-tm-navy">
            Go to dashboard
          </button>
        </>
      )}
    </div>
  )
}
