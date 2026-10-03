'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, Check, CreditCard, Image as ImageIcon, Loader2, Paperclip, Plus, Search, Sparkles, Upload } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { compressImage, compressUnder1MB } from '@/lib/imageCompress'
import { isSyntheticEmail, normalisePkMobile } from '@/lib/phone'
import { StepShell, StepSkip } from '@/components/onboarding/StepShell'
import { fieldState, fieldStateClasses } from '@/lib/onboarding/fieldState'
import { Ltr } from '@/components/onboarding/StepLayout'
import TaxonomySelector from '@/components/TaxonomySelector'
import CnicCapture, { type CnicCaptureState } from '@/components/identity/CnicCapture'
import EmailCard from '@/components/account/EmailCard'
import MobileNumberInput from '@/components/auth/MobileNumberInput'
import OtpCodeEntry from '@/components/auth/OtpCodeEntry'
import TimeSlotGrid from '@/components/forms/TimeSlotGrid'
import TutorVerifyGate from '@/components/upgrade/TutorVerifyGate'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { EXPERIENCE_BANDS, composeHeadline, composeBio } from '@/lib/onboarding/copy'
import { FEE_MIN_DEFAULT, FEE_MAX_DEFAULT, validateFeeRange } from '@/lib/fee'
import { resolveMasterIds, selectionForMasterIds } from '@/lib/taxonomy'
import { availabilityToSlots, slotsToAvailabilityList, type DaySlot } from '@/lib/timeSlots'
import { NEW_FLOW_ORDER, firstMissingStep, nextMissingAfter, stepDone, type FlowStepKey } from '@/lib/tutorFlow'
import type { ManualInstructions } from '@/lib/payments/provider'

// The NEW tutor onboarding (PR106-G3c). A SEPARATE component from the live
// CompleteProfileFlow (which is not touched): shown only when showNewOnboarding
// routes a viewer here. Every step renders through StepShell — heading, fields,
// ONE truly-fixed keyboard-safe button ("Next" / "Finish") — and saves through
// the SAME endpoints the old flow uses (/api/profile/save, /api/identity,
// /api/documents/upload, /api/auth/otp), so a tutor switching flows loses nothing.

type Facts = {
  fullName: string | null
  gender: string | null
  city: string | null
  area: string | null
  avatarUrl: string | null
  headline: string | null
  bio: string | null
  experienceYears: number | null
  feeMin: number | null
  feeMax: number | null
  jobTypes: string[]
  degrees: unknown[]
  subjectIds: number[]
  selfieDone: boolean
  availability: DaySlot[]
  phoneVerified: boolean
  phone: string
  whatsapp: string
  email: string
  feePaid: boolean
}

const TITLES: Record<FlowStepKey, { en: string; ur?: string }> = {
  gender: { en: 'Select your gender', ur: 'اپنی جنس منتخب کریں' },
  city: { en: 'Which city do you teach in?', ur: 'آپ کس شہر میں پڑھاتے ہیں؟' },
  area: { en: 'Which areas?', ur: 'کون سے علاقے؟' },
  level: { en: 'Which levels and subjects?', ur: 'کون سی جماعتیں اور مضامین؟' },
  subjects: { en: 'Which subjects?', ur: 'کون سے مضامین؟' },
  jobtype: { en: 'What work do you want?', ur: 'آپ کس قسم کا کام چاہتے ہیں؟' },
  fee: { en: 'What monthly fee do you expect?', ur: 'آپ کتنی ماہانہ فیس کی توقع رکھتے ہیں؟' },
  experience: { en: 'Years of experience', ur: 'تجربے کے سال' },
  degree: { en: 'Your education', ur: 'آپ کی تعلیم' },
  availability: { en: 'When can you teach?', ur: 'آپ کب پڑھا سکتے ہیں؟' },
  contact: { en: 'Contact', ur: 'رابطہ' },
  photo: { en: 'Add your photo', ur: 'اپنی تصویر لگائیں' },
  selfie: { en: 'Take a selfie' },
  cnic_number: { en: 'Your CNIC number', ur: 'آپ کا شناختی کارڈ نمبر' },
  cnic_photos: { en: 'Photos of your CNIC', ur: 'شناختی کارڈ کی تصاویر' },
  tagline: { en: 'Your tagline and bio', ur: 'آپ کا تعارف' },
  verify: { en: 'Get verified', ur: 'تصدیق کروائیں' },
  name: { en: 'Your full name' },
}

export default function NewOnboardingFlow({
  seed,
  smsAvailable = true,
  manual = null,
}: {
  seed: string
  smsAvailable?: boolean
  manual?: ManualInstructions | null
}) {
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { titles: jobTitles } = useJobTitles()
  const { map: cityMap } = useCityAreas()

  const [facts, setFacts] = useState<Facts | null>(null)
  const [stepKey, setStepKey] = useState<FlowStepKey | 'final' | null>(null)
  const [busy, setBusy] = useState(false)

  const ORDER = NEW_FLOW_ORDER

  // ---- load the tutor's own rows (RLS self-read) ---------------------------
  const load = useCallback(async (): Promise<Facts | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login?next=/tutor/onboarding')
      return null
    }
    const [{ data: p }, { data: tp }, subj, selfie] = await Promise.all([
      supabase.from('profiles').select('full_name, city, phone_verified_at, phone_number, whatsapp, email').eq('id', user.id).maybeSingle(),
      supabase.from('tutor_profiles').select('city, area, gender, avatar_url, headline, bio, experience_years, fee_min_pkr, fee_max_pkr, job_types, degrees, availability_list, verified_fee_paid_at').eq('id', user.id).maybeSingle(),
      supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
      supabase.from('user_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('kind', 'selfie'),
    ])
    const email = (p?.email as string) ?? ''
    return {
      fullName: (p?.full_name as string) ?? null,
      gender: (tp?.gender as string) ?? null,
      city: (tp?.city as string) ?? (p?.city as string) ?? null,
      area: (tp?.area as string) ?? null,
      avatarUrl: (tp?.avatar_url as string) ?? null,
      headline: (tp?.headline as string) ?? null,
      bio: (tp?.bio as string) ?? null,
      experienceYears: (tp?.experience_years as number | null) ?? null,
      feeMin: (tp?.fee_min_pkr as number | null) ?? null,
      feeMax: (tp?.fee_max_pkr as number | null) ?? null,
      jobTypes: (tp?.job_types as string[] | null) ?? [],
      degrees: Array.isArray(tp?.degrees) ? (tp.degrees as unknown[]) : [],
      subjectIds: (subj.data ?? []).map((r) => r.master_id as number),
      selfieDone: (selfie.count ?? 0) > 0,
      availability: availabilityToSlots(tp?.availability_list),
      phoneVerified: !!p?.phone_verified_at,
      phone: (p?.phone_number as string) ?? '',
      whatsapp: (p?.whatsapp as string) ?? '',
      email: isSyntheticEmail(email) ? '' : email,
      feePaid: !!tp?.verified_fee_paid_at,
    }
  }, [supabase, router])

  // The pure flow facts (lib/tutorFlow) projected from our Facts, for the
  // gap-based step model (shared with the old flow so "done" is identical).
  const flowFacts = useCallback((f: Facts) => ({
    fullName: f.fullName, gender: f.gender, city: f.city, area: f.area, avatarUrl: f.avatarUrl,
    headline: f.headline, bio: f.bio, experienceYears: f.experienceYears, hourlyRate: f.feeMin,
    jobTypes: f.jobTypes, degreesCount: (f.degrees ?? []).filter((d) => d && typeof d === 'object').length || (f.degrees ?? []).length,
    degreeDocCount: 0, degrees: f.degrees, cnicNumber: null, cnicImagePath: null, subjectCount: f.subjectIds.length,
    selfieDone: f.selfieDone, availabilityCount: f.availability.length, phoneVerified: f.phoneVerified,
    whatsapp: f.whatsapp, feePaid: f.feePaid, noDegreeYet: false, isSeed: false, isTeamAccount: false,
    isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
  }) as never, [])

  useEffect(() => {
    let live = true
    void (async () => {
      const f = await load()
      if (!live || !f) return
      setFacts(f)
      setStepKey(firstMissingStep(flowFacts(f), ORDER) ?? 'final')
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(async () => {
    const f = await load()
    if (f) setFacts(f)
    return f
  }, [load])

  // Save via /api/profile/save (same endpoint as the old flow).
  const saveProfile = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save.')
  }, [])

  const advanceFrom = useCallback((f: Facts, from: FlowStepKey) => {
    setStepKey(nextMissingAfter(flowFacts(f), from, ORDER) ?? 'final')
  }, [flowFacts, ORDER])

  // Save a patch, then advance to the next gap.
  const saveAndNext = useCallback(async (payload: Record<string, unknown>, patch: Partial<Facts>) => {
    setBusy(true)
    try {
      await saveProfile(payload)
      const f = { ...(facts as Facts), ...patch }
      setFacts(f)
      setBusy(false)
      if (stepKey && stepKey !== 'final') advanceFrom(f, stepKey)
    } catch (e) {
      setBusy(false)
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    }
  }, [saveProfile, facts, stepKey, advanceFrom, toast])

  const goBack = useCallback(() => {
    if (stepKey === 'final') { setStepKey(ORDER[ORDER.length - 1]); return }
    if (!stepKey) return
    const i = ORDER.indexOf(stepKey)
    if (i > 0) setStepKey(ORDER[i - 1])
  }, [stepKey, ORDER])

  const leave = useCallback(async (to: string) => {
    setBusy(true)
    try { await fetch('/api/tutor/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true }) }) } catch { /* leaving anyway */ }
    router.push(to)
  }, [router])

  // advance after a component-driven step (cnic/selfie/photo/verify) by reloading.
  const advanceAfter = useCallback(async (from: FlowStepKey) => {
    const f = await refresh()
    if (f) setStepKey(nextMissingAfter(flowFacts(f), from, ORDER) ?? 'final')
  }, [refresh, flowFacts, ORDER])

  if (!facts || !stepKey) {
    return <div className="fixed inset-0 z-[60] grid place-items-center bg-tm-bg text-xs font-bold text-gray-500">Loading…</div>
  }

  const stepIndex = stepKey === 'final' ? ORDER.length : ORDER.indexOf(stepKey)
  const title = stepKey === 'final' ? { en: 'Almost there' } : TITLES[stepKey]
  // "Finish" on the last step before Get verified (cnic_photos → tagline is last
  // content; verify is the fee). The last non-verify step shows "Finish".
  const isLastBeforeVerify = stepKey !== 'final' && nextMissingAfter(flowFacts(facts), stepKey, ORDER) === 'verify'
  const buttonLabel = isLastBeforeVerify ? 'Finish' : 'Next'

  // A thin wrapper so a step can render inside the shell with the shared button.
  const shell = (opts: {
    children: React.ReactNode
    onNext: () => void
    nextDisabled?: boolean
    skip?: React.ReactNode
    hideButton?: boolean
    headingEn?: string
    headingUr?: string
  }) => (
    <StepShell
      heading={opts.headingEn ?? title.en}
      headingUr={opts.headingUr ?? (stepKey !== 'final' ? TITLES[stepKey].ur : undefined)}
      stepIndex={stepIndex}
      stepTotal={ORDER.length}
      onBack={goBack}
      backDisabled={stepIndex <= 0}
      onFinishLater={() => void leave('/tutor/dashboard')}
      buttonLabel={buttonLabel}
      onNext={opts.onNext}
      nextDisabled={opts.nextDisabled}
      busy={busy}
      skip={opts.skip}
      hideButton={opts.hideButton}
    >
      {opts.children}
    </StepShell>
  )

  // ---------- GENDER ----------
  if (stepKey === 'gender') {
    return shell({
      onNext: () => facts.gender && advanceFrom(facts, 'gender'),
      nextDisabled: !facts.gender,
      children: (
        <div className="flex flex-wrap justify-center gap-2">
          {([
            ['male', 'Male', 'border-tm-navy bg-tm-navy'],
            ['female', 'Female', 'border-tm-red bg-tm-red'],
            ['trans', 'Trans', 'border-tm-green-deep bg-tm-green-deep'],
          ] as const).map(([val, label, fill]) => {
            const on = facts.gender === val
            return (
              <button key={val} type="button" aria-pressed={on}
                onClick={() => void saveAndNext({ tutorProfile: { gender: val } }, { gender: val })}
                className={`min-h-[44px] rounded-full border-2 px-6 text-sm font-black transition-colors ${on ? `${fill} text-white` : 'border-gray-200 bg-white text-tm-navy hover:border-gray-300'}`}>
                {label}
              </button>
            )
          })}
        </div>
      ),
    })
  }

  // ---------- CITY (up to 2) ----------
  if (stepKey === 'city') return <CityStep facts={facts} cities={cityMap.cities} shell={shell} onSave={(cities) => void saveAndNext({ profile: { city: cities[0] }, tutorProfile: {} }, { city: cities[0] })} />

  // ---------- AREAS ----------
  if (stepKey === 'area') return <AreaStep city={facts.city ?? ''} initial={facts.area ? [facts.area] : []} busy={busy} shell={shell}
    onSave={(areasByCity, mainCity) => void saveAndNext({ areasByCity, profile: { city: mainCity } }, { city: mainCity, area: (areasByCity[mainCity] ?? [])[0] ?? null })} />

  // ---------- SUBJECTS & LEVELS ----------
  if (stepKey === 'level' || stepKey === 'subjects')
    return <SubjectsStep initialIds={facts.subjectIds} busy={busy} shell={shell}
      onSave={(ids) => void saveAndNext({ subjectMasterIds: ids }, { subjectIds: ids })} />

  // ---------- TEACHING MODE ----------
  if (stepKey === 'jobtype') {
    const toggle = (name: string) => {
      const next = facts.jobTypes.includes(name) ? facts.jobTypes.filter((x) => x !== name) : [...facts.jobTypes, name]
      void saveProfile({ tutorProfile: { job_types: next, teaching_mode: next[0] ?? null } }).then(() => setFacts((f) => (f ? { ...f, jobTypes: next } : f))).catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save.'))
    }
    return shell({
      onNext: () => advanceFrom(facts, 'jobtype'),
      nextDisabled: facts.jobTypes.length === 0,
      children: (
        <div className="flex flex-wrap justify-center gap-2">
          {jobTitles.map((name) => {
            const on = facts.jobTypes.includes(name)
            return (
              <button key={name} type="button" aria-pressed={on} onClick={() => toggle(name)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors ${on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}>
                {on && <Check size={14} aria-hidden />}{name}
              </button>
            )
          })}
        </div>
      ),
    })
  }

  // ---------- FEE ----------
  if (stepKey === 'fee') return <FeeStep initialMin={facts.feeMin ?? FEE_MIN_DEFAULT} initialMax={facts.feeMax ?? FEE_MAX_DEFAULT} busy={busy} shell={shell}
    onSave={(min, max) => void saveAndNext({ tutorProfile: { fee_min_pkr: min, fee_max_pkr: max } }, { feeMin: min, feeMax: max })} />

  // ---------- EXPERIENCE ----------
  if (stepKey === 'experience') return shell({
    onNext: () => facts.experienceYears != null && advanceFrom(facts, 'experience'),
    nextDisabled: facts.experienceYears == null,
    children: (
      <div className="flex flex-wrap justify-center gap-2">
        {EXPERIENCE_BANDS.map((b) => {
          const on = facts.experienceYears === b.years
          return (
            <button key={b.label} type="button" aria-pressed={on}
              onClick={() => void saveAndNext({ tutorProfile: { experience_years: b.years } }, { experienceYears: b.years })}
              className={`min-h-[44px] rounded-full border-2 px-5 text-sm font-bold transition-colors ${on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-gray-300'}`}>
              {b.years === 0 ? 'New to teaching' : `${b.label} years`}
            </button>
          )
        })}
      </div>
    ),
  })

  // ---------- EDUCATION ----------
  if (stepKey === 'degree') return <EducationStep initialDegrees={facts.degrees} busy={busy} shell={shell} onSaved={() => void advanceAfter('degree')} />

  // ---------- AVAILABILITY (optional) ----------
  if (stepKey === 'availability') return <AvailabilityStep initial={facts.availability} busy={busy} shell={shell}
    onSave={async (slots) => {
      setBusy(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) await supabase.from('tutor_profiles').update({ availability_list: slotsToAvailabilityList(slots) }).eq('id', user.id)
        const f = { ...facts, availability: slots }; setFacts(f); setBusy(false); advanceFrom(f, 'availability')
      } catch (e) { setBusy(false); toast.error(e instanceof Error ? e.message : 'Could not save.') }
    }}
    onSkip={() => advanceFrom(facts, 'availability')} />

  // ---------- CONTACT (per-screen, missing only) ----------
  if (stepKey === 'contact') return <ContactStep facts={facts} smsAvailable={smsAvailable} shell={shell}
    onDone={() => void advanceAfter('contact')} onRefresh={refresh} saveProfile={saveProfile} setFacts={setFacts} />

  // ---------- PHOTO ----------
  if (stepKey === 'photo') return <PhotoStep seed={seed} current={facts.avatarUrl} shell={shell}
    onSave={(url) => void saveAndNext({ tutorProfile: { avatar_url: url } }, { avatarUrl: url })} />

  // ---------- SELFIE ----------
  if (stepKey === 'selfie') return <SelfieStep done={facts.selfieDone} shell={shell} onDone={() => void advanceAfter('selfie')} />

  // ---------- CNIC NUMBER ----------
  if (stepKey === 'cnic_number') return <CnicNumberStep shell={shell} onDone={() => void advanceAfter('cnic_number')} />

  // ---------- CNIC PHOTOS ----------
  if (stepKey === 'cnic_photos') return <NewCnicPhotos shell={shell} onDone={() => void advanceAfter('cnic_photos')} />

  // ---------- TAGLINE & BIO (AI-written, editable) ----------
  if (stepKey === 'tagline') return <TaglineStep facts={facts} shell={shell}
    onSave={(headline, bio) => void saveAndNext({ tutorProfile: { headline, bio } }, { headline, bio })} />

  // ---------- VERIFY (Get verified → existing payment flow) ----------
  if (stepKey === 'verify') return (
    <GetVerifiedStep title={title.en} stepIndex={stepIndex} stepTotal={ORDER.length}
      onBack={goBack} onFinishLater={() => void leave('/tutor/dashboard')} manual={manual}
      onDone={() => void advanceAfter('verify')} />
  )

  // ---------- FINAL ----------
  return (
    <StepShell heading="You're almost there" stepIndex={stepIndex} stepTotal={ORDER.length}
      onBack={goBack} backDisabled={false} onFinishLater={() => void leave('/tutor/dashboard')}
      buttonLabel="Go to dashboard" onNext={() => void leave('/tutor/dashboard')}>
      <p className="text-center text-xs leading-relaxed text-gray-500">
        You can edit anything later from your dashboard.
      </p>
    </StepShell>
  )
}

type ShellFn = (opts: {
  children: React.ReactNode
  onNext: () => void
  nextDisabled?: boolean
  skip?: React.ReactNode
  hideButton?: boolean
  headingEn?: string
  headingUr?: string
}) => React.ReactElement

// ---------------------------------------------------------------- City ------
function CityStep({ facts, cities, shell, onSave }: { facts: Facts; cities: string[]; shell: ShellFn; onSave: (cities: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(facts.city ? [facts.city] : [])
  const [q, setQ] = useState('')
  const [tried, setTried] = useState(false)
  const query = q.trim().toLowerCase()
  const shown = query ? cities.filter((c) => c.toLowerCase().includes(query)).slice(0, 30) : cities.slice(0, 24)
  const toggle = (name: string) => setSel((s) => (s.includes(name) ? s.filter((x) => x !== name) : s.length >= 2 ? [s[1], name] : [...s, name]))
  return shell({
    onNext: () => { if (sel.length === 0) { setTried(true); return } onSave(sel) },
    nextDisabled: false,
    children: (
      <div className="space-y-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search cities"
          className={`min-h-[44px] w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: sel.join(',') }))}`} />
        <div className="flex flex-wrap justify-center gap-2">
          {Array.from(new Set([...sel, ...shown])).map((name) => {
            const on = sel.includes(name)
            return (
              <button key={name} type="button" aria-pressed={on} onClick={() => toggle(name)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors ${on ? 'border-tm-green-deep bg-tm-tint-green text-tm-green-deep' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}>
                {on && <Check size={14} aria-hidden />}{name}
              </button>
            )
          })}
        </div>
        {tried && sel.length === 0 && (
          <p className="text-center text-[11px] font-bold text-tm-red">Pick your city.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">اپنا شہر منتخب کریں۔</span></p>
        )}
      </div>
    ),
  })
}

// ---------------------------------------------------------------- Areas -----
function AreaStep({ city, initial, busy, shell, onSave }: { city: string; initial: string[]; busy: boolean; shell: ShellFn; onSave: (areasByCity: Record<string, string[]>, mainCity: string) => void }) {
  const [ranked, setRanked] = useState<{ name: string; demand: number }[] | null>(null)
  const [all, setAll] = useState<string[]>([])
  const [sel, setSel] = useState<string[]>(initial)
  const [q, setQ] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/onboarding/areas?city=${encodeURIComponent(city)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) { setRanked(j.areas ?? []); setAll(j.all ?? []) } })
      .catch(() => setRanked([]))
    return () => { live = false }
  }, [city])

  const query = q.trim().toLowerCase()
  const matches = query ? all.filter((a) => a.toLowerCase().includes(query) && !sel.includes(a)).slice(0, 12) : []
  const canAddTyped = query.length >= 2 && !all.some((a) => a.toLowerCase() === query) && !sel.some((a) => a.toLowerCase() === query)
  const toggle = (name: string) => setSel((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))

  return shell({
    headingEn: `Which areas in ${city}?`,
    headingUr: `${city} میں کون سے علاقے؟`,
    onNext: () => { if (sel.length === 0) { setTried(true); return } onSave({ [city]: sel }, city) },
    children: (
      <div className="space-y-3">
        {ranked === null ? (
          <p className="flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              {Array.from(new Set([...sel, ...ranked.map((r) => r.name)])).map((name) => {
                const on = sel.includes(name)
                return (
                  <button key={name} type="button" aria-pressed={on} onClick={() => toggle(name)}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors ${on ? 'border-tm-green-deep bg-tm-tint-green text-tm-green-deep' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}>
                    {on && <Check size={14} aria-hidden />}{name}
                  </button>
                )
              })}
            </div>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="More areas" aria-label="Search more areas"
                className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 pl-9 text-sm outline-none focus:border-tm-navy" />
            </div>
            {(matches.length > 0 || canAddTyped) && (
              <div className="flex flex-wrap justify-center gap-2">
                {matches.map((name) => (
                  <button key={name} type="button" onClick={() => { toggle(name); setQ('') }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 text-sm font-bold text-tm-navy hover:border-tm-navy">
                    <Plus size={14} aria-hidden />{name}
                  </button>
                ))}
                {canAddTyped && (
                  <button type="button" onClick={() => { const name = q.trim(); setSel((s) => [...s, name]); setQ('') }}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-dashed border-tm-navy bg-white px-4 text-sm font-bold text-tm-navy">
                    <Plus size={14} aria-hidden />Add “{q.trim()}”
                  </button>
                )}
              </div>
            )}
            {tried && sel.length === 0 && (
              <p className="text-center text-[11px] font-bold text-tm-red">Pick at least one area.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">کم از کم ایک علاقہ منتخب کریں۔</span></p>
            )}
          </>
        )}
      </div>
    ),
  })
}

// --------------------------------------------------------- Subjects & levels
function SubjectsStep({ initialIds, busy, shell, onSave }: { initialIds: number[]; busy: boolean; shell: ShellFn; onSave: (ids: number[]) => void }) {
  const [level, setLevel] = useState('')
  const [grades, setGrades] = useState<string[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [tried, setTried] = useState(false)
  const [ready, setReady] = useState(false)

  // Prefill from the tutor's existing master ids (first category), so a returning
  // tutor sees their selection and does not lose it.
  useEffect(() => {
    let live = true
    void (async () => {
      if (initialIds.length > 0) {
        try {
          const sel = await selectionForMasterIds(initialIds)
          if (live && sel?.category) { setLevel(sel.category); setGrades(sel.levels); setSubjects(sel.subjects ?? []) }
        } catch { /* start empty */ }
      }
      if (live) setReady(true)
    })()
    return () => { live = false }
  }, [initialIds])

  const submit = async () => {
    if (subjects.length === 0 || grades.length === 0) { setTried(true); return }
    const ids = await resolveMasterIds(level || grades[0], grades, subjects)
    if (ids.length === 0) { setTried(true); return }
    onSave(Array.from(new Set(ids)))
  }

  return shell({
    onNext: () => void submit(),
    children: (
      <div className="space-y-3">
        {!ready ? (
          <p className="flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</p>
        ) : (
          <>
            <TaxonomySelector selectedLevel={level} setSelectedLevel={setLevel} selectedGrades={grades} setSelectedGrades={setGrades} selectedSubjects={subjects} setSelectedSubjects={setSubjects} />
            {tried && subjects.length === 0 && (
              <p className="text-center text-[11px] font-bold text-tm-red">Choose a level, a grade and at least one subject.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">ایک جماعت اور کم از کم ایک مضمون منتخب کریں۔</span></p>
            )}
          </>
        )}
      </div>
    ),
  })
}

// ---------------------------------------------------------------- Fee -------
function FeeStep({ initialMin, initialMax, busy, shell, onSave }: { initialMin: number; initialMax: number; busy: boolean; shell: ShellFn; onSave: (min: number, max: number) => void }) {
  const [min, setMin] = useState(String(initialMin))
  const [max, setMax] = useState(String(initialMax))
  const [err, setErr] = useState<{ en: string; ur: string } | null>(null)
  const parse = (s: string): number | null => { const d = s.replace(/[^\d]/g, ''); return d ? Number(d) : null }
  const fmt = (s: string): string => { const d = s.replace(/[^\d]/g, ''); return d ? Number(d).toLocaleString('en-PK') : '' }
  const submit = () => { const mn = parse(min); const mx = parse(max); const e = validateFeeRange(mn, mx); if (e) { setErr(e); return } setErr(null); onSave(mn as number, mx as number) }
  const box = (label: string, value: string, set: (v: string) => void) => {
    const n = parse(value)
    return (
      <label className="space-y-1">
        <span className="block text-xs font-bold text-tm-navy">{label}</span>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-gray-500">Rs</span>
          <input value={fmt(value)} inputMode="numeric" onChange={(e) => set(e.target.value)}
            className={`min-h-[48px] w-full rounded-xl border p-3 pl-10 text-sm outline-none ${fieldStateClasses(fieldState({ value, valid: (n ?? 0) > 0 }))}`} />
        </div>
      </label>
    )
  }
  return shell({
    onNext: submit,
    children: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">{box('Minimum', min, setMin)}{box('Maximum', max, setMax)}</div>
        {err && (<div role="alert"><p className="text-[11px] font-bold text-tm-red">{err.en}</p><p lang="ur" dir="rtl" className="text-[11px] font-semibold text-tm-red">{err.ur}</p></div>)}
      </div>
    ),
  })
}

// ------------------------------------------------------------- Education ----
type DegRow = { key: string; title: string; docId: string; preview: string | null; uploading: boolean }
let degSeq = 0
function EducationStep({ initialDegrees, busy, shell, onSaved }: { initialDegrees: unknown[]; busy: boolean; shell: ShellFn; onSaved: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<DegRow[]>(() => {
    const existing = (initialDegrees ?? []).map((d) => (typeof d === 'object' && d ? (d as { title?: string; docId?: string }) : { title: String(d) }))
      .filter((d) => (d.title ?? '').trim())
    const base = existing.map((d) => ({ key: `d${++degSeq}`, title: d.title ?? '', docId: d.docId ?? '', preview: d.docId ? `/api/documents/${d.docId}/preview` : null, uploading: false }))
    while (base.length < 3) base.push({ key: `d${++degSeq}`, title: '', docId: '', preview: null, uploading: false })
    return base
  })
  const [tried, setTried] = useState(false)
  const patch = (key: string, p: Partial<DegRow>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...p } : r)))

  async function upload(key: string, title: string, file: File) {
    patch(key, { uploading: true })
    try {
      const img = await compressUnder1MB(file)
      const fd = new FormData(); fd.append('kind', 'degree'); fd.append('file', img); fd.append('label', title.trim() || 'Degree certificate')
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not upload.')
      patch(key, { docId: j.documentId as string, preview: j.previewUrl as string, uploading: false })
      toast.success('Certificate added.')
    } catch (e) { patch(key, { uploading: false }); toast.error(e instanceof Error ? e.message : 'Could not upload.') }
  }

  const named = rows.filter((r) => r.title.trim())
  async function save() {
    if (named.length === 0) { setTried(true); return }
    const degrees = named.map((r) => ({ title: r.title.trim(), docId: r.docId || undefined }))
    try { await fetch('/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tutorProfile: { degrees } }) }).then((r) => { if (!r.ok) throw new Error('save') }); onSaved() }
    catch { toast.error('Could not save. Please try again.') }
  }

  return shell({
    onNext: () => void save(),
    children: (
      <div className="space-y-3">
        <ul className="space-y-2">
          {rows.map((e, i) => (
            <li key={e.key} className="flex items-center gap-2">
              <input value={e.title} onChange={(ev) => patch(e.key, { title: ev.target.value })} placeholder={`Degree ${i + 1}`} aria-label={`Degree ${i + 1}`}
                className={`min-h-[48px] flex-1 rounded-xl border p-3 text-sm font-semibold outline-none ${fieldStateClasses(fieldState({ value: e.title }))}`} />
              {e.preview ? (
                <a href={e.preview} target="_blank" rel="noopener noreferrer" aria-label="View certificate"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-tm-green-deep bg-tm-tint-green text-tm-green-deep">
                  <Check size={18} aria-hidden />
                </a>
              ) : (
                <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:border-tm-navy hover:text-tm-navy" aria-label="Upload certificate">
                  {e.uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
                  <input type="file" accept="image/*" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void upload(e.key, e.title, f); ev.currentTarget.value = '' }} />
                </label>
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setRows((l) => [...l, { key: `d${++degSeq}`, title: '', docId: '', preview: null, uploading: false }])}
          aria-label="Add a degree row" className="grid h-9 w-9 place-items-center rounded-full border border-gray-200 text-tm-navy hover:border-tm-navy">
          <Plus size={16} aria-hidden />
        </button>
        {tried && named.length === 0 && (
          <p className="text-[11px] font-bold text-tm-red">Type at least one degree.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">کم از کم ایک ڈگری لکھیں۔</span></p>
        )}
      </div>
    ),
  })
}

// ---------------------------------------------------------- Availability ----
function AvailabilityStep({ initial, busy, shell, onSave, onSkip }: { initial: DaySlot[]; busy: boolean; shell: ShellFn; onSave: (s: DaySlot[]) => void; onSkip: () => void }) {
  const [slots, setSlots] = useState<DaySlot[]>(initial)
  return shell({
    onNext: () => onSave(slots),
    nextDisabled: slots.length === 0,
    skip: <StepSkip onClick={onSkip}>Skip for now</StepSkip>,
    children: <TimeSlotGrid value={slots} onChange={setSlots} disabled={busy} />,
  })
}

// --------------------------------------------------------------- Contact ----
function ContactStep({ facts, smsAvailable, shell, onDone, onRefresh, saveProfile, setFacts }: {
  facts: Facts; smsAvailable: boolean; shell: ShellFn; onDone: () => void
  onRefresh: () => Promise<Facts | null>; saveProfile: (p: Record<string, unknown>) => Promise<void>; setFacts: (f: (p: Facts | null) => Facts | null) => void
}) {
  // Screens: mobile-signup (verified) → [whatsapp, email]; email-signup → [mobile, whatsapp].
  const screens = facts.phoneVerified ? (['whatsapp', 'email'] as const) : (['mobile', 'whatsapp'] as const)
  const [sub, setSub] = useState(0)
  const screen = screens[sub]
  const next = () => { if (sub + 1 < screens.length) setSub(sub + 1); else onDone() }

  const toast = useToast()
  const [whatsapp, setWhatsapp] = useState(facts.whatsapp)
  const waValid = !!normalisePkMobile(whatsapp)

  if (screen === 'mobile') return <MobileVerifyScreen facts={facts} smsAvailable={smsAvailable} shell={shell} onVerified={async () => { await onRefresh(); next() }} />

  if (screen === 'whatsapp') return shell({
    headingEn: 'Your WhatsApp number', headingUr: 'آپ کا واٹس ایپ نمبر',
    onNext: () => { if (whatsapp.trim()) void saveProfile({ profile: { whatsapp: normalisePkMobile(whatsapp) ?? whatsapp.trim() } }).then(() => { setFacts((f) => (f ? { ...f, whatsapp } : f)); next() }).catch(() => toast.error('Could not save.')); else next() },
    nextDisabled: !!whatsapp.trim() && !waValid,
    skip: <StepSkip onClick={next}>Skip</StepSkip>,
    children: (
      <div className="space-y-2">
        <MobileNumberInput value={whatsapp} onChange={setWhatsapp} ariaLabel="WhatsApp number"
          className={`min-h-[48px] w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: whatsapp, valid: waValid }))}`} />
        {whatsapp.trim() && !waValid && (<p className="text-[11px] font-bold text-tm-red">Enter a valid Pakistani mobile number.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">درست پاکستانی موبائل نمبر درج کریں۔</span></p>)}
        <button type="button" onClick={() => setWhatsapp(facts.phone)} disabled={!facts.phone} className="text-[11px] font-bold text-tm-navy hover:underline disabled:opacity-40">Same as my mobile</button>
      </div>
    ),
  })

  // email (optional)
  return shell({
    headingEn: 'Your email', headingUr: undefined,
    onNext: next,
    skip: <StepSkip onClick={next}>I don&rsquo;t use email</StepSkip>,
    children: <EmailCard />,
  })
}

function MobileVerifyScreen({ facts, smsAvailable, shell, onVerified }: { facts: Facts; smsAvailable: boolean; shell: ShellFn; onVerified: () => void }) {
  const toast = useToast()
  const [phone, setPhone] = useState(facts.phone)
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  async function send() { setBusy(true); setError(null); try { const r = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', phone }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { toast.error(j.error ?? 'Could not send.'); return } setSent(true); toast.success(j.alreadySent ? 'We already sent a code to this number. Please use it.' : 'Code sent.') } finally { setBusy(false) } }
  async function verify() { setBusy(true); setError(null); setErrorUr(null); try { const r = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', phone, code: otp }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { setError(j.error ?? 'Could not verify.'); setErrorUr(j.errorUr ?? null); if (j.locked) setLocked(true); return } toast.success('Number verified.'); onVerified() } finally { setBusy(false) } }

  if (!smsAvailable) return shell({ headingEn: 'Your mobile number', headingUr: 'آپ کا موبائل نمبر', onNext: () => {}, hideButton: true, children: (
    <p className="rounded-xl bg-tm-tint-gold px-3 py-3 text-center text-xs font-bold text-tm-gold-ink">SMS codes are not available yet. Please contact support to verify your number.</p>
  ) })

  return shell({
    headingEn: 'Your mobile number', headingUr: 'آپ کا موبائل نمبر',
    onNext: () => (sent ? void verify() : void send()),
    nextDisabled: !phone || (sent && otp.length < 6),
    children: (
      <div className="space-y-3">
        <MobileNumberInput value={phone} readOnly={sent} onChange={setPhone} />
        {sent && (
          <OtpCodeEntry code={otp} onChange={setOtp} onVerify={() => void verify()} busy={busy} locked={locked} label="" autoFocus={false}
            onDifferentNumber={() => { setSent(false); setOtp(''); setError(null); setErrorUr(null) }} error={error} errorUr={errorUr} />
        )}
      </div>
    ),
  })
}

// --------------------------------------------- shared capture buttons -------
// PR106-G4a §1: a square tile + two colour-coded buttons — "Open camera" (navy)
// and "Choose from gallery" (deep green). The tile is itself tappable (opens the
// camera). No labels, no explanation — the photo is the confirmation.
function CaptureButtons({ facingMode, busy, done, preview, onPick }: {
  facingMode: 'user' | 'environment'; busy: boolean; done: boolean; preview: React.ReactNode | null; onPick: (f: File) => void
}) {
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = '' }
  return (
    <div className="mx-auto w-44 space-y-3">
      <button type="button" onClick={() => camRef.current?.click()} disabled={busy} aria-label="Take a photo"
        className="relative block aspect-square w-full overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-tm-bg">
        {preview ?? (
          <span className="grid h-full w-full place-items-center text-gray-500">
            {busy ? <Loader2 size={28} className="animate-spin" aria-hidden /> : done ? <Check size={28} aria-hidden /> : <Camera size={28} aria-hidden />}
          </span>
        )}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => camRef.current?.click()} disabled={busy}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-3 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50">
          <Camera size={15} aria-hidden /> Open camera
        </button>
        <button type="button" onClick={() => galRef.current?.click()} disabled={busy}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-green-deep px-3 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50">
          <ImageIcon size={15} aria-hidden /> Choose from gallery
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture={facingMode} className="hidden" onChange={pick} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={pick} />
    </div>
  )
}

// ---------------------------------------------------------------- Photo -----
function PhotoStep({ seed, current, shell, onSave }: { seed: string; current: string | null; shell: ShellFn; onSave: (url: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [preview, setPreview] = useState<string | null>(current)
  const [uploading, setUploading] = useState(false)
  async function upload(file: File) {
    setUploading(true)
    try {
      const img = await compressImage(file)
      const path = `${seed}/${Date.now()}-${img.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from('avatars').upload(path, img, { upsert: true })
      if (error) throw new Error(error.message)
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setPreview(URL.createObjectURL(img)); onSave(data.publicUrl)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload the photo.') } finally { setUploading(false) }
  }
  return shell({
    onNext: () => {}, hideButton: !preview, nextDisabled: !preview,
    children: (
      <div className="space-y-2">
        <CaptureButtons facingMode="environment" busy={uploading} done={!!preview}
          preview={preview ? (<img src={preview} alt="Your photo" className="h-full w-full object-cover" />) : null} onPick={(f) => void upload(f)} />
        <div className="text-center"><TermsLink /></div>
      </div>
    ),
  })
}

// ---------------------------------------------------------------- Selfie ----
function SelfieStep({ done, shell, onDone }: { done: boolean; shell: ShellFn; onDone: () => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploaded = done || !!preview
  async function upload(file: File) {
    setUploading(true)
    try {
      const img = await compressUnder1MB(file)
      const body = new FormData(); body.append('kind', 'selfie'); body.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.previewUrl) throw new Error(data?.error || 'That photo could not be uploaded.')
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      toast.success('Selfie uploaded.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload the selfie.') } finally { setUploading(false) }
  }
  return shell({
    onNext: onDone, nextDisabled: !uploaded,
    children: (
      <div className="space-y-2">
        <CaptureButtons facingMode="user" busy={uploading} done={uploaded}
          preview={preview ? (<img src={preview} alt="Your selfie" className="h-full w-full object-cover" />) : null} onPick={(f) => void upload(f)} />
        <div className="text-center"><TermsLink /></div>
      </div>
    ),
  })
}

// ---------------------------------------------------------- CNIC number -----
// The number screen keeps the shared CnicCapture (number only) — it owns the
// 5-7-1 formatting and the save-number gate the photos step then relies on.
function CnicNumberStep({ shell, onDone }: { shell: ShellFn; onDone: () => void }) {
  const toast = useToast()
  const [cap, setCap] = useState<CnicCaptureState | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!cap?.valid) return
    setBusy(true)
    try {
      const r = await fetch('/api/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-number', cnicNumber: cap.number }) })
      if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? 'Could not save your CNIC number.'); return }
      onDone()
    } finally { setBusy(false) }
  }
  return shell({
    onNext: () => void save(), nextDisabled: !cap?.valid,
    children: (
      <div className="space-y-2">
        <CnicCapture show="number" hideChecklist onState={setCap} />
        <div className="text-center"><TermsLink /></div>
      </div>
    ),
  })
}

// ---------------------------------------------------------- CNIC photos -----
// PR106-G4a §2: Front and Back side by side, each with its own "Take a photo"
// (navy) and "Upload a file" (deep green) buttons — no side labels, no
// verification line. The CNIC number was saved on the previous step, so the
// server's save-number-first rule is already satisfied. Both sides upload to the
// same /api/documents/upload (kind 'cnic'), then /api/identity submit finalises.
function NewCnicPhotos({ shell, onDone }: { shell: ShellFn; onDone: () => void }) {
  const toast = useToast()
  const [front, setFront] = useState(false)
  const [back, setBack] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!front || !back) return
    setBusy(true)
    try {
      const r = await fetch('/api/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit' }) })
      if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? 'Could not submit for checking.'); return }
      toast.success('CNIC sent for checking.')
      onDone()
    } finally { setBusy(false) }
  }
  return shell({
    onNext: () => void submit(), nextDisabled: !front || !back,
    children: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <CnicSideCapture side="front" done={front} onDone={() => setFront(true)} />
          <CnicSideCapture side="back" done={back} onDone={() => setBack(true)} />
        </div>
        <div className="text-center"><TermsLink /></div>
      </div>
    ),
  })
}

function CnicSideCapture({ side, done, onDone }: { side: 'front' | 'back'; done: boolean; onDone: () => void }) {
  const toast = useToast()
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uploaded = done || !!preview
  async function upload(file: File) {
    setBusy(true)
    try {
      const img = await compressUnder1MB(file)
      const fd = new FormData(); fd.append('kind', 'cnic'); fd.append('label', side); fd.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.documentId) throw new Error(j.error ?? (res.status === 413 ? 'That photo was too large. Please try again.' : 'Upload failed.'))
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload.') } finally { setBusy(false) }
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = '' }
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => camRef.current?.click()} disabled={busy} aria-label={`${side} of your CNIC`}
        className="relative block aspect-[1.6] w-full overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-tm-bg">
        {preview ? (<img src={preview} alt={`CNIC ${side}`} className="h-full w-full object-cover" />) : (
          <span className="grid h-full w-full place-items-center text-gray-500">
            {busy ? <Loader2 size={22} className="animate-spin" aria-hidden /> : uploaded ? <Check size={22} aria-hidden /> : <Camera size={22} aria-hidden />}
          </span>
        )}
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => camRef.current?.click()} disabled={busy}
          className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg bg-tm-navy px-2 text-[11px] font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50">
          <Camera size={13} aria-hidden /> Take a photo
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg bg-tm-green-deep px-2 text-[11px] font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50">
          <Paperclip size={13} aria-hidden /> Upload a file
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
    </div>
  )
}

// ------------------------------------------------------- Tagline & bio ------
// PR106-G4a §3: the tagline and short bio, written by Claude from the tutor's own
// saved answers (POST /api/tutor/tagline → fallback composer on any failure).
// Both fields are prefilled and fully editable; nothing is published unseen, and
// "Rewrite with AI" re-asks. Saved with the step's Finish button.
function TaglineStep({ facts, shell, onSave }: { facts: Facts; shell: ShellFn; onSave: (headline: string, bio: string) => void }) {
  const toast = useToast()
  const [tagline, setTagline] = useState(facts.headline ?? '')
  const [bio, setBio] = useState(facts.bio ?? '')
  const [loading, setLoading] = useState(false)
  const started = useRef(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tutor/tagline', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && typeof j.tagline === 'string') { setTagline(j.tagline); setBio(typeof j.bio === 'string' ? j.bio : '') }
      else toast.error('Could not write it just now. You can type your own.')
    } catch { toast.error('Could not write it just now. You can type your own.') } finally { setLoading(false) }
  }, [toast])

  // Auto-write once on open when either field is still blank (this step only
  // appears when one is). A tutor who already has both sees their own text.
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!tagline.trim() || !bio.trim()) void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return shell({
    onNext: () => { if (tagline.trim() && bio.trim()) onSave(tagline.trim(), bio.trim()) },
    nextDisabled: !tagline.trim() || !bio.trim(),
    children: (
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-bold text-tm-navy">Tagline</span>
          <input value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} aria-label="Tagline"
            className={`min-h-[48px] w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: tagline }))}`} />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-bold text-tm-navy">About you</span>
          <textarea value={bio} rows={4} onChange={(e) => setBio(e.target.value)} aria-label="About you"
            className={`w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: bio }))}`} />
        </label>
        <button type="button" onClick={() => void generate()} disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-tm-red underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />} Rewrite with AI
          <span lang="ur" dir="rtl" className="font-semibold text-gray-500">دوبارہ لکھوائیں</span>
        </button>
      </div>
    ),
  })
}

// ------------------------------------------------------------ Get verified --
// PR106-G4a §4: a clean intro — the heading, ONE message, and one red button
// that opens the EXISTING payment flow (TutorVerifyGate, unchanged). The fee
// cards, the bank panel and the pay-later link live inside that flow, which
// opens only on the red button — they are not on this intro screen.
function GetVerifiedStep({ title, stepIndex, stepTotal, onBack, onFinishLater, manual, onDone }: {
  title: string; stepIndex: number; stepTotal: number; onBack: () => void; onFinishLater: () => void
  manual: ManualInstructions | null; onDone: () => void
}) {
  const [pay, setPay] = useState(false)
  return (
    <StepShell heading={title} headingUr={TITLES.verify.ur} stepIndex={stepIndex} stepTotal={stepTotal}
      onBack={onBack} backDisabled={false} onFinishLater={onFinishLater} buttonLabel="Finish" onNext={() => {}} hideButton>
      {pay ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <TutorVerifyGate onClose={onDone} showDismiss={false} manual={manual} payLaterHref="/tutor/dashboard" />
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-sm leading-relaxed text-gray-700">
            After verification, you can apply to tuitions and jobs and contact parents and employers directly. You pay no commission to <Ltr>TutorMint</Ltr>, and never pay anyone in <Ltr>TutorMint</Ltr>&rsquo;s name.
          </p>
          <p lang="ur" dir="rtl" className="text-sm leading-relaxed text-gray-700">
            تصدیق کے بعد آپ ٹیوشنز اور نوکریوں کے لیے درخواست دے سکتے ہیں اور والدین اور اداروں سے براہِ راست رابطہ کر سکتے ہیں۔ آپ <Ltr>TutorMint</Ltr> کو کوئی کمیشن ادا نہیں کرتے، اور <Ltr>TutorMint</Ltr> کے نام پر کسی کو کچھ ادا نہیں کرتے۔
          </p>
          <button type="button" onClick={() => setPay(true)}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-red px-6 text-sm font-bold text-white hover:bg-tm-red-hover">
            <CreditCard size={16} aria-hidden /> Complete verification
          </button>
        </div>
      )}
    </StepShell>
  )
}

function TermsLink() {
  return <Link href="/terms#identity" className="mt-2 inline-block text-[11px] font-bold text-tm-red underline-offset-2 hover:underline">Terms</Link>
}
