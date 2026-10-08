'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, Check, CreditCard, Image as ImageIcon, Loader2, Paperclip, Plus, Search, Sparkles, Upload } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { compressImage, compressUnder1MB } from '@/lib/imageCompress'
import { isSyntheticEmail, normalisePkMobile, looksLikeEmail } from '@/lib/phone'
import { StepShell } from '@/components/onboarding/StepShell'
import { fieldState, fieldStateClasses } from '@/lib/onboarding/fieldState'
import CnicCapture, { type CnicCaptureState } from '@/components/identity/CnicCapture'
import VerifyBenefitsDialog from '@/components/tutor/VerifyBenefitsDialog'
import { useVerifyCheckout, CHECKOUT_FAIL_MESSAGES } from '@/components/tutor/useVerifyCheckout'
import { verificationFeeCardState } from '@/lib/tutorDashboard'
import MobileNumberInput from '@/components/auth/MobileNumberInput'
import OtpCodeEntry from '@/components/auth/OtpCodeEntry'
import TimeSlotGrid from '@/components/forms/TimeSlotGrid'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { EXPERIENCE_BANDS, composeHeadline, composeBio } from '@/lib/onboarding/copy'
import { FEE_MIN_DEFAULT, FEE_MAX_DEFAULT, validateFeeRange } from '@/lib/fee'
import { resolveMasterIds, fetchTaxonomyTree, fetchCoreTree, fetchNonLegacyMasters, fetchSubjectUrdu, loadedNoGradeLevels, type TaxonomyNode } from '@/lib/taxonomy'
import { subjectGroups, filterMore } from '@/lib/onboarding/subjectGroups'
import { availabilityToSlots, slotsToAvailabilityList, type DaySlot } from '@/lib/timeSlots'
import { NEW_FLOW_ORDER, firstMissingStep, nextMissingAfter, stepDone, type FlowStepKey } from '@/lib/tutorFlow'
import LogoLoader from '@/components/LogoLoader'
import { ChipSkeletons } from '@/components/Skeletons'

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
  // PR106-G6 §5: watermarked preview URLs for the already-uploaded documents, so
  // going back to the photo / selfie / CNIC steps shows a thumbnail, not an empty
  // box. null when that side has nothing uploaded yet.
  selfiePreview: string | null
  cnicFrontPreview: string | null
  cnicBackPreview: string | null
  // PR106 HOTFIX-PAY2: the real saved CNIC number, so the gap-flow knows the
  // cnic_number step is done and a refresh does not resume at it.
  cnicNumber: string | null
  // PR106-G6 §1/§5: the subjects step's raw tap selection, held in the parent so
  // going back then forward keeps an in-progress (unsaved) pick. Empty on load;
  // the step prefills from the saved subjectIds on first open, then syncs here.
  subjCats: string[]
  subjByCat: Record<string, string[]>
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
  payFailed = false,
  helpWaHref = null,
}: {
  seed: string
  smsAvailable?: boolean
  /** WhatsApp support link for the subjects step's "Need help?" line. */
  helpWaHref?: string | null
  /** The tutor returned from a failed/cancelled fee payment — show one line on
   *  the Complete Your Verification screen so they can try again (PR106-H3 §2). */
  payFailed?: boolean
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { titles: jobTitles } = useJobTitles()
  const { map: cityMap } = useCityAreas()

  const [facts, setFacts] = useState<Facts | null>(null)
  const [stepKey, setStepKey] = useState<FlowStepKey | 'final' | null>(null)
  const [busy, setBusy] = useState(false)
  // PR106-G5 §3.9: step errors render as a banner at the TOP of the step, never
  // as a bottom toast that would cover the fixed "Next" button. Cleared whenever
  // the step changes.
  const [flowError, setFlowError] = useState<string | null>(null)

  const ORDER = NEW_FLOW_ORDER

  // ---- load the tutor's own rows (RLS self-read) ---------------------------
  const load = useCallback(async (): Promise<Facts | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login?next=/tutor/onboarding')
      return null
    }
    const [{ data: p }, { data: tp }, subj, docsRes] = await Promise.all([
      supabase.from('profiles').select('full_name, city, phone_verified_at, phone_number, whatsapp, email, cnic_number').eq('id', user.id).maybeSingle(),
      supabase.from('tutor_profiles').select('city, area, gender, avatar_url, headline, bio, experience_years, fee_min_pkr, fee_max_pkr, job_types, degrees, availability_list, verified_fee_paid_at').eq('id', user.id).maybeSingle(),
      supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
      // All identity docs (selfie + CNIC front/back), newest first, so each
      // step can prefill a thumbnail from the latest upload (§5).
      supabase.from('user_documents').select('id, kind, label, created_at').eq('user_id', user.id).in('kind', ['selfie', 'cnic']).order('created_at', { ascending: false }),
    ])
    const docs = (docsRes.data ?? []) as { id: string; kind: string; label: string | null }[]
    const latest = (kind: string, label?: string) => docs.find((d) => d.kind === kind && (label === undefined || d.label === label))
    const previewUrl = (id?: string) => (id ? `/api/documents/${id}/preview` : null)
    const selfieDoc = latest('selfie')
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
      selfieDone: !!selfieDoc,
      availability: availabilityToSlots(tp?.availability_list),
      phoneVerified: !!p?.phone_verified_at,
      phone: (p?.phone_number as string) ?? '',
      whatsapp: (p?.whatsapp as string) ?? '',
      email: isSyntheticEmail(email) ? '' : email,
      feePaid: !!tp?.verified_fee_paid_at,
      selfiePreview: previewUrl(selfieDoc?.id),
      cnicFrontPreview: previewUrl(latest('cnic', 'front')?.id),
      cnicBackPreview: previewUrl(latest('cnic', 'back')?.id),
      cnicNumber: (p?.cnic_number as string) ?? null,
      subjCats: [],
      subjByCat: {},
    }
  }, [supabase, router])

  // The pure flow facts (lib/tutorFlow) projected from our Facts, for the
  // gap-based step model (shared with the old flow so "done" is identical).
  const flowFacts = useCallback((f: Facts) => ({
    fullName: f.fullName, gender: f.gender, city: f.city, area: f.area, avatarUrl: f.avatarUrl,
    headline: f.headline, bio: f.bio, experienceYears: f.experienceYears, hourlyRate: f.feeMin,
    jobTypes: f.jobTypes, degreesCount: (f.degrees ?? []).filter((d) => d && typeof d === 'object').length || (f.degrees ?? []).length,
    // HOTFIX-PAY2: project the REAL CNIC state (was hardcoded null, which made a
    // refresh always resume at the CNIC steps). cnic_number done = saved number;
    // cnic_photos done = BOTH front and back documents present.
    degreeDocCount: 0, degrees: f.degrees, cnicNumber: f.cnicNumber, cnicImagePath: (f.cnicFrontPreview && f.cnicBackPreview) ? 'y' : null, subjectCount: f.subjectIds.length,
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

  // A step error belongs to its step: clear it whenever the step changes.
  useEffect(() => { setFlowError(null) }, [stepKey])

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

  // Save a patch, then advance to the next gap. A failure shows at the top of the
  // step (never a bottom toast over the button). "Could not save." is only the
  // fallback — a stated server reason (e.g. a locked field) is shown as-is.
  const saveAndNext = useCallback(async (payload: Record<string, unknown>, patch: Partial<Facts>) => {
    setBusy(true)
    setFlowError(null)
    try {
      await saveProfile(payload)
      const f = { ...(facts as Facts), ...patch }
      setFacts(f)
      setBusy(false)
      if (stepKey && stepKey !== 'final') advanceFrom(f, stepKey)
    } catch (e) {
      setBusy(false)
      setFlowError(e instanceof Error ? e.message : 'We couldn’t save that. Please try again.')
    }
  }, [saveProfile, facts, stepKey, advanceFrom])

  // PR106-H3 §3 — single-choice steps (Gender, Experience, …): one tap selects
  // (turns green immediately) and auto-advances after ~0.3s. The fixed "Next"
  // stays visible (the shell renders it) so a tutor who goes back can keep an
  // earlier choice without re-tapping. Re-tapping within the window cancels the
  // pending advance and re-picks. Multi-select steps do NOT use this.
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current) }, [])
  const pickSingle = useCallback((payload: Record<string, unknown>, patch: Partial<Facts>) => {
    setFlowError(null)
    setFacts((cur) => (cur ? { ...cur, ...patch } : cur)) // green now
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => { void saveAndNext(payload, patch) }, 300)
  }, [saveAndNext])

  const goBack = useCallback(() => {
    setFlowError(null)
    if (autoTimer.current) clearTimeout(autoTimer.current)
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
    return <LogoLoader fullPage />
  }

  const stepIndex = stepKey === 'final' ? ORDER.length : ORDER.indexOf(stepKey)
  const title = stepKey === 'final' ? { en: 'Almost there' } : TITLES[stepKey]
  // "Finish" on the last step before Get verified (cnic_photos → tagline is last
  // content; verify is the fee). The last non-verify step shows "Finish".
  const isLastBeforeVerify = stepKey !== 'final' && nextMissingAfter(flowFacts(facts), stepKey, ORDER) === 'verify'
  const buttonLabel = isLastBeforeVerify ? 'Finish' : 'Next'

  // A thin wrapper so a step can render inside the shell with the shared button.
  // The step's error (if any) renders as a banner at the TOP of the content,
  // above the fields and well clear of the fixed bottom button (PR106-G5 §3.9).
  const shell = (opts: {
    children: React.ReactNode
    onNext: () => void
    nextDisabled?: boolean
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
      buttonLabel={buttonLabel}
      onNext={opts.onNext}
      nextDisabled={opts.nextDisabled}
      busy={busy}
      hideButton={opts.hideButton}
    >
      {flowError && (
        <div role="alert" className="mb-4 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 whitespace-pre-line text-xs font-semibold leading-relaxed text-tm-red-hover">
          {flowError}
        </div>
      )}
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
                onClick={() => pickSingle({ tutorProfile: { gender: val } }, { gender: val })}
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
    return <SubjectsStep initialIds={facts.subjectIds} draftCats={facts.subjCats} draftByCat={facts.subjByCat} shell={shell} helpWaHref={helpWaHref}
      onDraft={(cats, byCat) => setFacts((f) => (f ? { ...f, subjCats: cats, subjByCat: byCat } : f))}
      onSave={(ids) => void saveAndNext({ subjectMasterIds: ids }, { subjectIds: ids })} />

  // ---------- TEACHING MODE ----------
  if (stepKey === 'jobtype') {
    const toggle = (name: string) => {
      const next = facts.jobTypes.includes(name) ? facts.jobTypes.filter((x) => x !== name) : [...facts.jobTypes, name]
      void saveProfile({ tutorProfile: { job_types: next, teaching_mode: next[0] ?? null } }).then(() => setFacts((f) => (f ? { ...f, jobTypes: next } : f))).catch((e) => setFlowError(e instanceof Error ? e.message : 'We couldn’t save that. Please try again.'))
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
              onClick={() => pickSingle({ tutorProfile: { experience_years: b.years } }, { experienceYears: b.years })}
              className={`min-h-[44px] rounded-full border-2 px-5 text-sm font-bold transition-colors ${on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-gray-300'}`}>
              {b.years === 0 ? 'New to teaching' : `${b.label} years`}
            </button>
          )
        })}
      </div>
    ),
  })

  // ---------- EDUCATION ----------
  if (stepKey === 'degree') return <EducationStep initialDegrees={facts.degrees} busy={busy} shell={shell} onError={setFlowError} onSaved={() => void advanceAfter('degree')} />

  // ---------- AVAILABILITY (mandatory — PR106-G5 §1.3) ----------
  if (stepKey === 'availability') return <AvailabilityStep initial={facts.availability} busy={busy} shell={shell}
    onSave={async (slots) => {
      setBusy(true)
      setFlowError(null)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) await supabase.from('tutor_profiles').update({ availability_list: slotsToAvailabilityList(slots) }).eq('id', user.id)
        const f = { ...facts, availability: slots }; setFacts(f); setBusy(false); advanceFrom(f, 'availability')
      } catch (e) { setBusy(false); setFlowError(e instanceof Error ? e.message : 'We couldn’t save that. Please try again.') }
    }} />

  // ---------- CONTACT (per-screen, missing only) ----------
  if (stepKey === 'contact') return <ContactStep facts={facts} smsAvailable={smsAvailable} shell={shell}
    onDone={() => void advanceAfter('contact')} onRefresh={refresh} saveProfile={saveProfile} setFacts={setFacts} onError={setFlowError} />

  // ---------- PHOTO ----------
  if (stepKey === 'photo') return <PhotoStep seed={seed} current={facts.avatarUrl} shell={shell} onError={setFlowError}
    onSave={(url) => void saveAndNext({ tutorProfile: { avatar_url: url } }, { avatarUrl: url })} />

  // ---------- SELFIE ----------
  if (stepKey === 'selfie') return <SelfieStep done={facts.selfieDone} initialPreview={facts.selfiePreview} shell={shell} onError={setFlowError} onDone={() => void advanceAfter('selfie')} />

  // ---------- CNIC NUMBER ----------
  if (stepKey === 'cnic_number') return <CnicNumberStep shell={shell} onError={setFlowError} onDone={() => void advanceAfter('cnic_number')} />

  // ---------- CNIC PHOTOS ----------
  if (stepKey === 'cnic_photos') return <NewCnicPhotos shell={shell} onError={setFlowError} initial={{ frontPreview: facts.cnicFrontPreview, backPreview: facts.cnicBackPreview }} onDone={() => void advanceAfter('cnic_photos')} />

  // ---------- TAGLINE & BIO (AI-written, editable) ----------
  if (stepKey === 'tagline') return <TaglineStep facts={facts} shell={shell} onError={setFlowError}
    onDraft={(patch) => setFacts((f) => (f ? { ...f, ...patch } : f))}
    onSave={(headline, bio) => void saveAndNext({ tutorProfile: { headline, bio } }, { headline, bio })} />

  // ---------- COMPLETE YOUR VERIFICATION (final screen → PayPro directly) ----
  if (stepKey === 'verify') {
    // Reopening onboarding after the fee is paid goes to the dashboard — the
    // pay screen (and its "Get verified now" button) is never shown again
    // (PR106-H3 §2 / urgent fix).
    if (facts.feePaid) {
      void leave('/tutor/dashboard')
      return <LogoLoader fullPage />
    }
    return <GetVerifiedStep stepTotal={ORDER.length} onBack={goBack} payFailed={payFailed} />
  }

  // ---------- FINAL ----------
  return (
    <StepShell heading="You're almost there" stepIndex={stepIndex} stepTotal={ORDER.length}
      onBack={goBack} backDisabled={false}
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
          <ChipSkeletons count={8} />
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
// PR106-G6 §1: the OLD flow's tap-tap selection, inside StepShell — level CHIPS
// (the academic categories, multi-select), then subject CHIPS per chosen level
// (grades are folded in, as the old flow does — every grade of a picked level is
// taken). No dropdown, no grade step, no helper text. Selected chip = light green
// + tick + deep-green border (OChip). The in-progress pick is held by the parent
// (draftCats/draftByCat) so going back then forward keeps it; a returning tutor
// with saved subjects is prefilled from them on first open.
function SubjectsStep({ initialIds, draftCats, draftByCat, shell, helpWaHref, onDraft, onSave }: {
  initialIds: number[]; draftCats: string[]; draftByCat: Record<string, string[]>; shell: ShellFn
  /** WhatsApp support link (app_settings), shown after 60s with nothing picked. */
  helpWaHref?: string | null
  onDraft: (cats: string[], byCat: Record<string, string[]>) => void
  onSave: (ids: number[]) => void
}) {
  const [tree, setTree] = useState<TaxonomyNode | null>(null)
  const [core, setCore] = useState<TaxonomyNode>({})
  // Short Urdu subject names (migration 149), shown under the English name.
  const [urdu, setUrdu] = useState<Record<string, string>>({})
  const [selCats, setSelCats] = useState<string[]>(draftCats)
  const [selByCat, setSelByCat] = useState<Record<string, string[]>>(draftByCat)
  const [levelQ, setLevelQ] = useState('')
  const [tried, setTried] = useState(false)
  // Hotfix (7 Oct 2026): a level's main subjects show first; the rest sit
  // behind "More subjects", with a search box per level.
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({})
  const [moreQ, setMoreQ] = useState<Record<string, string>>({})
  const [suggested, setSuggested] = useState<Record<string, string[]>>({})
  const [helpVisible, setHelpVisible] = useState(false)
  const prefilled = useRef(draftCats.length > 0)

  // A tutor still on this step after 60 seconds gets a small WhatsApp help link
  // (shown only while nothing is picked).
  useEffect(() => {
    const t = setTimeout(() => setHelpVisible(true), 60_000)
    return () => clearTimeout(t)
  }, [])

  // The platform's typo-tolerant + Roman-Urdu matching (/api/search/suggest —
  // "fizics" → Physics, "hisab" → Mathematics), debounced per open search box.
  useEffect(() => {
    const ctrl = new AbortController()
    const timers = Object.entries(moreQ).map(([cat, q]) => {
      const term = q.trim()
      if (term.length < 2) return null
      return setTimeout(() => {
        fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { suggestions?: { group: string; label: string }[] } | null) => {
            const labels = (j?.suggestions ?? []).filter((x) => x.group === 'subject').map((x) => x.label)
            setSuggested((cur) => ({ ...cur, [cat]: labels }))
          })
          .catch(() => {})
      }, 250)
    })
    return () => { ctrl.abort(); for (const t of timers) if (t) clearTimeout(t) }
  }, [moreQ])

  useEffect(() => {
    let live = true
    void Promise.all([fetchTaxonomyTree(), fetchCoreTree(), fetchSubjectUrdu()])
      .then(([t, c, u]) => { if (live) { setTree(t); setCore(c); setUrdu(u) } })
      .catch(() => {})
    // First open with a saved selection and no draft yet → prefill from the saved
    // master ids, grouped by every category taught. Later opens use the draft.
    if (!prefilled.current && initialIds.length > 0) {
      prefilled.current = true
      void (async () => {
        try {
          const masters = await fetchNonLegacyMasters()
          const byId = new Map(masters.map((m) => [m.id, m]))
          const cats: string[] = []
          const byCat: Record<string, string[]> = {}
          for (const id of initialIds) {
            const m = byId.get(id)
            if (!m || !m.subject) continue
            if (!byCat[m.category]) { byCat[m.category] = []; cats.push(m.category) }
            if (!byCat[m.category].includes(m.subject)) byCat[m.category].push(m.subject)
          }
          if (live && cats.length > 0) { setSelCats(cats); setSelByCat(byCat); onDraft(cats, byCat) }
        } catch { /* start empty */ }
      })()
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleCat = (cat: string) => {
    const nextCats = selCats.includes(cat) ? selCats.filter((c) => c !== cat) : [...selCats, cat]
    const nextByCat = { ...selByCat }
    if (!selCats.includes(cat)) nextByCat[cat] = nextByCat[cat] ?? []
    else delete nextByCat[cat]
    setSelCats(nextCats); setSelByCat(nextByCat); onDraft(nextCats, nextByCat)
  }
  const toggleSub = (cat: string, sub: string) => {
    const cur = selByCat[cat] ?? []
    const nextByCat = { ...selByCat, [cat]: cur.includes(sub) ? cur.filter((x) => x !== sub) : [...cur, sub] }
    setSelByCat(nextByCat); onDraft(selCats, nextByCat)
  }

  const total = Object.values(selByCat).reduce((n, a) => n + a.length, 0)
  const submit = async () => {
    if (total === 0 || !tree) { setTried(true); return }
    const all: number[] = []
    for (const cat of selCats) {
      const subs = selByCat[cat] ?? []
      if (subs.length === 0) continue
      const ids = await resolveMasterIds(cat, Object.keys(tree[cat] ?? {}), subs)
      all.push(...ids)
    }
    const ids = Array.from(new Set(all))
    if (ids.length === 0) { setTried(true); return }
    onSave(ids)
  }

  const cats = tree ? Object.keys(tree) : []
  const lq = levelQ.trim().toLowerCase()
  const shownCats = lq ? cats.filter((c) => c.toLowerCase().includes(lq)) : cats

  return shell({
    onNext: () => void submit(),
    nextDisabled: total === 0,
    children: (
      <div className="space-y-4">
        {!tree ? (
          <ChipSkeletons count={8} />
        ) : (
          <>
            {/* Level chips (categories) */}
            <div className="space-y-2">
              {cats.length > 6 && (
                <input value={levelQ} onChange={(e) => setLevelQ(e.target.value)} placeholder="Search levels" aria-label="Search levels"
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-tm-navy" />
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {Array.from(new Set([...selCats, ...shownCats])).map((c) => (
                  <OChip key={c} label={c} selected={selCats.includes(c)} onClick={() => toggleCat(c)} />
                ))}
              </div>
            </div>
            {/* One subject list per chosen LEVEL (never per grade): the main
                subjects first, the rest behind "More subjects" — opened straight
                away when the level has no main subjects. A picked subject shows
                once, ticked, with the main chips. */}
            {selCats.map((cat) => {
              const picked = selByCat[cat] ?? []
              const g = subjectGroups(tree, core, cat, picked, loadedNoGradeLevels().includes(cat))
              const open = g.noMain || !!moreOpen[cat]
              const q = moreQ[cat] ?? ''
              const moreShown = filterMore(g.more, q, suggested[cat] ?? [])
              return (
                <section key={cat} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3">
                  <p className="text-sm font-black text-tm-navy">{cat}</p>
                  {g.main.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {g.main.map((sub) => (
                        <OChip key={sub} large label={sub} sub={urdu[sub]} selected={picked.includes(sub)} onClick={() => toggleSub(cat, sub)} />
                      ))}
                    </div>
                  )}
                  {!g.noMain && g.more.length > 0 && (
                    <button type="button" aria-expanded={open} onClick={() => setMoreOpen((m) => ({ ...m, [cat]: !m[cat] }))}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-tm-navy px-4 text-sm font-bold text-tm-navy hover:bg-tm-tint-navy">
                      {open ? 'Fewer subjects' : <><Plus size={14} aria-hidden />More subjects</>}
                    </button>
                  )}
                  {open && g.more.length > 0 && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
                        <input value={q} onChange={(e) => setMoreQ((m) => ({ ...m, [cat]: e.target.value }))}
                          placeholder="Search subjects" aria-label={`Search ${cat} subjects`}
                          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 pl-9 text-sm outline-none focus:border-tm-navy" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {moreShown.map((sub) => (
                          <OChip key={sub} large label={sub} sub={urdu[sub]} selected={false} onClick={() => toggleSub(cat, sub)} />
                        ))}
                      </div>
                      {moreShown.length === 0 && (
                        <p className="text-center text-xs text-gray-500">No subject matches “{q.trim()}”.</p>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
            {tried && total === 0 && (
              <p className="text-center text-[11px] font-bold text-tm-red">Choose a level and at least one subject.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">ایک جماعت اور کم از کم ایک مضمون منتخب کریں۔</span></p>
            )}
            {helpVisible && total === 0 && helpWaHref && (
              <p className="text-center">
                <a href={helpWaHref} target="_blank" rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center text-xs font-bold text-tm-green-deep underline-offset-2 hover:underline">
                  Need help? WhatsApp us
                </a>
              </p>
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
function EducationStep({ initialDegrees, busy, shell, onSaved, onError }: { initialDegrees: unknown[]; busy: boolean; shell: ShellFn; onSaved: () => void; onError: (m: string) => void }) {
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
    } catch (e) { patch(key, { uploading: false }); onError(e instanceof Error ? e.message : 'We couldn’t upload that. Please try again.') }
  }

  const named = rows.filter((r) => r.title.trim())
  async function save() {
    if (named.length === 0) { setTried(true); return }
    const degrees = named.map((r) => ({ title: r.title.trim(), docId: r.docId || undefined }))
    try { await fetch('/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tutorProfile: { degrees } }) }).then((r) => { if (!r.ok) throw new Error('save') }); onSaved() }
    catch { onError('We couldn’t save that. Please try again.') }
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
// Mandatory (PR106-G5 §1.3): "Next" is enabled only with at least one slot.
// PR106-G6 §2: NO slots are preselected — it opens empty (only the tutor's own
// saved slots prefill it), so nothing is chosen on their behalf.
function AvailabilityStep({ initial, busy, shell, onSave }: { initial: DaySlot[]; busy: boolean; shell: ShellFn; onSave: (s: DaySlot[]) => void }) {
  const [slots, setSlots] = useState<DaySlot[]>(initial)
  return shell({
    onNext: () => onSave(slots),
    nextDisabled: slots.length === 0,
    children: <TimeSlotGrid value={slots} onChange={setSlots} disabled={busy} />,
  })
}

// --------------------------------------------------------------- Contact ----
function ContactStep({ facts, smsAvailable, shell, onDone, onRefresh, saveProfile, setFacts, onError }: {
  facts: Facts; smsAvailable: boolean; shell: ShellFn; onDone: () => void
  onRefresh: () => Promise<Facts | null>; saveProfile: (p: Record<string, unknown>) => Promise<void>; setFacts: (f: (p: Facts | null) => Facts | null) => void
  onError: (m: string) => void
}) {
  // Screens: mobile-signup (verified) → [whatsapp, email]; email-signup → [mobile, whatsapp].
  const screens = facts.phoneVerified ? (['whatsapp', 'email'] as const) : (['mobile', 'whatsapp'] as const)
  const [sub, setSub] = useState(0)
  const screen = screens[sub]
  const next = () => { if (sub + 1 < screens.length) setSub(sub + 1); else onDone() }

  // §5: keep what is typed when leaving and returning — sync to the parent draft.
  const [whatsapp, setWhatsappRaw] = useState(facts.whatsapp)
  const setWhatsapp = (v: string) => { setWhatsappRaw(v); setFacts((f) => (f ? { ...f, whatsapp: v } : f)) }
  const waValid = !!normalisePkMobile(whatsapp)
  const [email, setEmailRaw] = useState(facts.email)
  const setEmail = (v: string) => { setEmailRaw(v); setFacts((f) => (f ? { ...f, email: v } : f)) }
  const emailValid = looksLikeEmail(email.trim().toLowerCase())

  if (screen === 'mobile') return <MobileVerifyScreen facts={facts} smsAvailable={smsAvailable} shell={shell} onError={onError} onVerified={async () => { await onRefresh(); next() }} />

  if (screen === 'whatsapp') return shell({
    headingEn: 'Your WhatsApp number', headingUr: 'آپ کا واٹس ایپ نمبر',
    onNext: () => { if (whatsapp.trim()) void saveProfile({ profile: { whatsapp: normalisePkMobile(whatsapp) ?? whatsapp.trim() } }).then(() => next()).catch(() => onError('We couldn’t save that. Please try again.')); else next() },
    nextDisabled: !!whatsapp.trim() && !waValid,
    children: (
      <div className="space-y-2">
        <MobileNumberInput value={whatsapp} onChange={setWhatsapp} ariaLabel="WhatsApp number"
          className={`min-h-[48px] w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: whatsapp, valid: waValid }))}`} />
        {whatsapp.trim() && !waValid && (<p className="text-[11px] font-bold text-tm-red">Enter a valid Pakistani mobile number.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">درست پاکستانی موبائل نمبر درج کریں۔</span></p>)}
        <button type="button" onClick={() => setWhatsapp(facts.phone)} disabled={!facts.phone} className="text-[11px] font-bold text-tm-navy hover:underline disabled:opacity-40">Same as my mobile</button>
      </div>
    ),
  })

  // email (optional) — PR106-G6 §3/§5/§6: one box, the fixed Next only. An empty
  // Next continues (email is optional); a valid email sends the confirmation link
  // then continues. No card, no sub-heading, no label, no separate send button.
  const submitEmail = async () => {
    const e = email.trim().toLowerCase()
    if (!e) { next(); return }
    if (!emailValid) { onError('Enter a valid email address, or leave it blank.'); return }
    try {
      const res = await fetch('/api/account/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e }) })
      if (!res.ok) { onError((await res.json().catch(() => ({}))).error ?? 'We couldn’t send the confirmation link. Please try again.'); return }
    } catch { onError('We couldn’t send the confirmation link. Please try again.'); return }
    next()
  }
  // "Email (optional)" — plain English, no Urdu on these simple words (owner
  // hotfix, 5 Oct 2026). Next continues with the box empty; a typed address is
  // format-checked and gets the confirmation link, and the tutor continues
  // without verifying it. Nothing after this step needs an email.
  return shell({
    headingEn: 'Email (optional)', headingUr: undefined,
    onNext: () => void submitEmail(),
    children: (
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email (optional)"
        inputMode="email" autoCapitalize="none" autoCorrect="off"
        className={`min-h-[48px] w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: email, valid: !email.trim() || emailValid }))}`} />
    ),
  })
}

function MobileVerifyScreen({ facts, smsAvailable, shell, onVerified, onError }: { facts: Facts; smsAvailable: boolean; shell: ShellFn; onVerified: () => void; onError: (m: string) => void }) {
  const toast = useToast()
  const [phone, setPhone] = useState(facts.phone)
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  async function send() { setBusy(true); setError(null); try { const r = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', phone }) }); const j = await r.json().catch(() => ({})); if (!r.ok) { onError(j.error ?? 'We couldn’t send the code. Please try again.'); return } setSent(true); toast.success(j.alreadySent ? 'We already sent a code to this number. Please use it.' : 'Code sent.') } finally { setBusy(false) } }
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
// PR106-G6 §7: a square preview tile, then TWO full-width buttons, one per row —
// "Open camera" (navy) above "Choose from gallery" (deep green), each on one line
// (no wrap). Once an image is added the labels become "Retake photo" / "Choose
// another" so it is clear how to replace it. The tile is itself tappable (camera).
function CaptureButtons({ facingMode, busy, done, preview, onPick }: {
  facingMode: 'user' | 'environment'; busy: boolean; done: boolean; preview: React.ReactNode | null; onPick: (f: File) => void
}) {
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = '' }
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={() => camRef.current?.click()} disabled={busy} aria-label="Take a photo"
        className="relative mx-auto block aspect-square w-40 overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-tm-bg">
        {preview ?? (
          <span className="grid h-full w-full place-items-center text-gray-500">
            {busy ? <Loader2 size={28} className="animate-spin" aria-hidden /> : done ? <Check size={28} aria-hidden /> : <Camera size={28} aria-hidden />}
          </span>
        )}
      </button>
      <button type="button" onClick={() => camRef.current?.click()} disabled={busy}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50">
        <Camera size={16} aria-hidden /> {done ? 'Retake photo' : 'Open camera'}
      </button>
      <button type="button" onClick={() => galRef.current?.click()} disabled={busy}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-tm-green-deep px-4 text-sm font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50">
        <ImageIcon size={16} aria-hidden /> {done ? 'Choose another' : 'Choose from gallery'}
      </button>
      <input ref={camRef} type="file" accept="image/*" capture={facingMode} className="hidden" onChange={pick} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={pick} />
    </div>
  )
}

// ---------------------------------------------------------------- Photo -----
function PhotoStep({ seed, current, shell, onSave, onError }: { seed: string; current: string | null; shell: ShellFn; onSave: (url: string) => void; onError: (m: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
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
    } catch (e) { onError(e instanceof Error ? e.message : 'We couldn’t upload that photo. Please try again.') } finally { setUploading(false) }
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
function SelfieStep({ done, initialPreview, shell, onDone, onError }: { done: boolean; initialPreview: string | null; shell: ShellFn; onDone: () => void; onError: (m: string) => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<string | null>(initialPreview)
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
      setPreview((old) => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      toast.success('Selfie uploaded.')
    } catch (e) { onError(e instanceof Error ? e.message : 'We couldn’t upload that selfie. Please try again.') } finally { setUploading(false) }
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
function CnicNumberStep({ shell, onDone, onError }: { shell: ShellFn; onDone: () => void; onError: (m: string) => void }) {
  const [cap, setCap] = useState<CnicCaptureState | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!cap?.valid) return
    setBusy(true)
    try {
      const r = await fetch('/api/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-number', cnicNumber: cap.number }) })
      if (!r.ok) { onError((await r.json().catch(() => ({}))).error ?? 'We couldn’t save your CNIC number. Please check it and try again.'); return }
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
// PR106-G6 §8: the two sides are STACKED vertically, each with its own English
// label, box, and two FULL-WIDTH buttons ("Take a photo" navy over "Upload a
// file" deep green) — never four small buttons on one line. A returning tutor
// sees the saved side as a thumbnail (§5) and the labels read "Retake photo" /
// "Choose another".
function NewCnicPhotos({ shell, onDone, onError, initial }: {
  shell: ShellFn; onDone: () => void; onError: (m: string) => void
  initial: { frontPreview: string | null; backPreview: string | null }
}) {
  const toast = useToast()
  const [front, setFront] = useState(!!initial.frontPreview)
  const [back, setBack] = useState(!!initial.backPreview)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!front || !back) return
    setBusy(true)
    try {
      const r = await fetch('/api/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit' }) })
      if (!r.ok) { onError((await r.json().catch(() => ({}))).error ?? 'We couldn’t send your CNIC for checking. Please try again.'); return }
      toast.success('CNIC sent for checking.')
      onDone()
    } finally { setBusy(false) }
  }
  return shell({
    onNext: () => void submit(), nextDisabled: !front || !back,
    children: (
      <div className="space-y-5">
        <CnicSideCapture side="front" initialPreview={initial.frontPreview} onDone={() => setFront(true)} onError={onError} />
        <CnicSideCapture side="back" initialPreview={initial.backPreview} onDone={() => setBack(true)} onError={onError} />
        <div className="text-center"><TermsLink /></div>
      </div>
    ),
  })
}

function CnicSideCapture({ side, initialPreview, onDone, onError }: { side: 'front' | 'back'; initialPreview: string | null; onDone: () => void; onError: (m: string) => void }) {
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(initialPreview)
  const [busy, setBusy] = useState(false)
  const has = !!preview
  const label = side === 'front' ? 'Front of CNIC' : 'Back of CNIC'
  async function upload(file: File) {
    setBusy(true)
    try {
      const img = await compressUnder1MB(file)
      const fd = new FormData(); fd.append('kind', 'cnic'); fd.append('label', side); fd.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.documentId) throw new Error(j.error ?? (res.status === 413 ? 'That photo was too large. Please try again.' : 'Upload failed.'))
      setPreview((old) => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'We couldn’t upload that. Please try again.') } finally { setBusy(false) }
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = '' }
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-tm-navy">{label}</p>
      <button type="button" onClick={() => camRef.current?.click()} disabled={busy} aria-label={label}
        className="relative block aspect-[1.6] w-full overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-tm-bg">
        {preview ? (<img src={preview} alt={label} className="h-full w-full object-cover" />) : (
          <span className="grid h-full w-full place-items-center text-gray-500">
            {busy ? <Loader2 size={22} className="animate-spin" aria-hidden /> : <Camera size={22} aria-hidden />}
          </span>
        )}
      </button>
      <button type="button" onClick={() => camRef.current?.click()} disabled={busy}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50">
        <Camera size={16} aria-hidden /> {has ? 'Retake photo' : 'Take a photo'}
      </button>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-tm-green-deep px-4 text-sm font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50">
        <Paperclip size={16} aria-hidden /> {has ? 'Choose another' : 'Upload a file'}
      </button>
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
function TaglineStep({ facts, shell, onSave, onError, onDraft }: { facts: Facts; shell: ShellFn; onSave: (headline: string, bio: string) => void; onError: (m: string) => void; onDraft: (patch: Partial<Facts>) => void }) {
  const [tagline, setTaglineRaw] = useState(facts.headline ?? '')
  const [bio, setBioRaw] = useState(facts.bio ?? '')
  const [loading, setLoading] = useState(false)
  const started = useRef(false)
  const bioRef = useRef<HTMLTextAreaElement>(null)
  // Keep the parent's draft in step (§5): going back then forward restores what
  // was typed but not yet saved.
  const setTagline = (v: string) => { setTaglineRaw(v); onDraft({ headline: v }) }
  const setBio = (v: string) => { setBioRaw(v); onDraft({ bio: v }) }

  // §6.11: the About-you box grows to fit the whole bio — no inner scrollbar; the
  // page scrolls if needed. min-height ~8 lines so it uses the empty space.
  useEffect(() => {
    const el = bioRef.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [bio])

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tutor/tagline', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && typeof j.tagline === 'string') { setTagline(j.tagline); setBio(typeof j.bio === 'string' ? j.bio : '') }
      else onError('We couldn’t write it just now — please type your own tagline and bio.')
    } catch { onError('We couldn’t write it just now — please type your own tagline and bio.') } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError])

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
          <textarea ref={bioRef} value={bio} rows={8} onChange={(e) => setBio(e.target.value)} aria-label="About you"
            className={`min-h-[12rem] w-full resize-none overflow-hidden rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(fieldState({ value: bio }))}`} />
        </label>
        <button type="button" onClick={() => void generate()} disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-tm-red underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />} Rewrite with AI
        </button>
      </div>
    ),
  })
}

// ------------------------------------------------- Complete Your Verification
// PR106-G4b §1: ONE final screen. The progress bar is full (stepIndex ===
// stepTotal) and there is no step after it. English only. The red button starts
// PayPro DIRECTLY (useVerifyCheckout → /api/payments/checkout 'verified', which
// reuses a pending < 24h invoice) and redirects; any failure (incl. PayPro not
// open) shows one friendly line and keeps the button to retry. No CNIC card, no
// bank/transfer, no pay-later exit, no TutorVerifyGate, no Urdu on this screen.
// "What do I get?" opens the shared VerifyBenefitsDialog.
function GetVerifiedStep({ stepTotal, onBack, payFailed = false }: {
  stepTotal: number; onBack: () => void; payFailed?: boolean
}) {
  const { start, busy, reason } = useVerifyCheckout()
  const [benefits, setBenefits] = useState(false)
  const benefitState = verificationFeeCardState({ feePaid: false, verifiedOk: false, findable: false })
  return (
    <StepShell heading="Complete Your Verification" stepIndex={stepTotal} stepTotal={stepTotal}
      onBack={onBack} backDisabled={false} buttonLabel="Finish" onNext={() => {}} hideButton>
      <div className="space-y-4 text-center">
        {payFailed && (
          <p role="alert" className="rounded-xl border border-tm-red/30 bg-tm-tint-red px-3 py-2 text-xs font-semibold leading-relaxed text-tm-red-hover">
            Your last payment didn&rsquo;t go through. Nothing was charged — please try again.
          </p>
        )}
        <p className="text-sm leading-relaxed text-gray-700">
          After verification, you can apply to tuitions and jobs and contact parents and employers directly. You pay no commission to TutorMint, and never pay anyone in TutorMint&rsquo;s name.
        </p>
        <p className="rounded-xl bg-tm-tint-green/60 px-3 py-2 text-[12px] font-semibold leading-snug text-tm-green-deep">
          Spam Free Platform Fee. We keep TutorMint clean of fake and spam accounts.
        </p>
        <button type="button" onClick={() => void start()} disabled={busy}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-red px-6 text-sm font-bold text-white hover:bg-tm-red-hover disabled:opacity-60">
          <CreditCard size={16} aria-hidden /> {busy ? 'Starting…' : 'Get verified now'}
        </button>
        {reason && (
          <p className="mx-auto max-w-xs px-2 text-center text-xs font-semibold leading-relaxed text-tm-red">
            {CHECKOUT_FAIL_MESSAGES[reason]}
          </p>
        )}
        <button type="button" onClick={() => setBenefits(true)}
          className="text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline">
          What do I get?
        </button>
      </div>
      <VerifyBenefitsDialog open={benefits} onClose={() => setBenefits(false)} state={benefitState} />
    </StepShell>
  )
}

function TermsLink() {
  return <Link href="/terms#identity" className="mt-2 inline-block text-[11px] font-bold text-tm-red underline-offset-2 hover:underline">Terms</Link>
}

// A tap chip for the subjects step (PR106-G6 §1/§2): selected = light green fill +
// tick + deep-green border, matching the shared input colours.
function OChip({ label, selected, onClick, large = false, sub }: { label: string; selected: boolean; onClick: () => void; large?: boolean; sub?: string }) {
  // `sub` = the short Urdu name, under the English one (owner, 8 Oct 2026). A
  // two-line chip is a pill with rounded corners rather than a full circle end.
  return (
    <button type="button" aria-pressed={selected} onClick={onClick}
      className={`inline-flex ${large ? 'min-h-[48px] px-5 text-base' : 'min-h-[44px] px-4 text-sm'} ${sub ? 'rounded-[18px] py-1.5' : 'rounded-full'} items-center gap-1.5 border font-bold transition-colors ${selected ? 'border-tm-green-deep bg-tm-tint-green text-tm-green-deep' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}>
      {selected && <Check size={14} aria-hidden />}
      {sub ? (
        <span className="flex flex-col items-start leading-tight">
          <span>{label}</span>
          <span lang="ur" dir="rtl" className="text-[13px] font-semibold">{sub}</span>
        </span>
      ) : label}
    </button>
  )
}
