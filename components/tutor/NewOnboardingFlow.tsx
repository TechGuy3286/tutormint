'use client'

import { useSubjectWords } from '@/lib/searchWords'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, Check, CreditCard, Image as ImageIcon, Loader2, Paperclip, Plus, Search, Sparkles, Upload, X } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { useDocLocks, refreshDocLocks } from '@/lib/useDocLocks'
import { canPick } from '@/lib/docLockCore'
import DocLockNotice from '@/components/identity/DocLockNotice'
import { compressUnder1MB } from '@/lib/imageCompress'
import { usePhotoCropUpload } from '@/components/photo/usePhotoCropUpload'
import HidePhotoToggle from '@/components/tutor/HidePhotoToggle'
import { isSyntheticEmail, normalisePkMobile, looksLikeEmail } from '@/lib/phone'
import { StepShell } from '@/components/onboarding/StepShell'
import { fieldState, fieldStateClasses } from '@/lib/onboarding/fieldState'
import CnicCapture, { type CnicCaptureState } from '@/components/identity/CnicCapture'
import VerifyBenefitsDialog from '@/components/tutor/VerifyBenefitsDialog'
import { verificationFeeCardState } from '@/lib/tutorDashboard'
import MobileNumberInput from '@/components/auth/MobileNumberInput'
import OtpCodeEntry from '@/components/auth/OtpCodeEntry'
import TimeSlotGrid from '@/components/forms/TimeSlotGrid'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { EXPERIENCE_BANDS, composeHeadline, composeBio } from '@/lib/onboarding/copy'
import { FEE_MIN_DEFAULT, FEE_MAX_DEFAULT, validateFeeRange } from '@/lib/fee'
import { fetchTaxonomyTree, fetchCoreTree, fetchNonLegacyMasters, fetchSubjectUrdu, type TaxonomyNode } from '@/lib/taxonomy'
import {
  applyQuickPick, canContinue as canContinueSel, levelRanges, pickApplied, resolveQuickPicks, resolveSelection, searchSubjects,
  selectionChips, selectionCounts, selectionFromIds, subjectsOffered, toggleGrade, toggleRange, toggleSubject,
  type Master as RangeMaster, type RangeSelection,
} from '@/lib/onboarding/levelRanges'
import { TUTOR_SUBJECT_CAP, TOO_MANY_SUBJECTS } from '@/lib/tutorSubjectCap'
import { availabilityToSlots, slotsToAvailabilityList, type DaySlot } from '@/lib/timeSlots'
import { NEW_FLOW_ORDER, firstMissingStep, nextMissingAfter, stepDone, type FlowStepKey } from '@/lib/tutorFlow'
import LogoLoader from '@/components/LogoLoader'
import WhatsMissing from '@/components/tutor/WhatsMissing'
import { missingSummary } from '@/lib/onboarding/missingItems'
import { payChoiceHref } from '@/lib/returnTo'
import { deriveCnicStatus } from '@/lib/cnicStatus'
import { googleVisibilityLine, tutorIndexRequirements, tutorProfileIndexable } from '@/lib/seo/indexable'
import type { FlowFacts } from '@/lib/tutorFlow'
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
  // The subjects step's selection (levels, grades, subjects), held in the parent
  // so going back then forward keeps an in-progress pick. Empty on load; the
  // step reads the saved subjectIds on first open, then syncs here.
  subjSel: RangeSelection
  // What staff have approved so far — for the "visible on Google" line.
  cnicApproved: boolean
  photoApproved: boolean
  selfieApproved: boolean
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
  initialStep = null,
  returnTo = null,
}: {
  seed: string
  /** Where the tutor was before onboarding (the tuition they tapped Apply on),
   *  validated on the server — used in place of the dashboard at the end
   *  (owner, 15 Oct 2026). */
  returnTo?: string | null
  /** Open at this step (a "Fix now" link), not at the first missing one. */
  initialStep?: FlowStepKey | null
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
      supabase.from('profiles').select('full_name, city, phone_verified_at, phone_number, whatsapp, email, cnic_number, cnic_image_path, cnic_verified_at, verification_state, profile_pic_status, selfie_status').eq('id', user.id).maybeSingle(),
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
      subjSel: {},
      cnicApproved: deriveCnicStatus((p ?? {}) as never) === 'approved',
      photoApproved: p?.profile_pic_status === 'approved',
      selfieApproved: p?.selfie_status === 'approved',
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
      // A "Fix now" link names its step; otherwise open at the first gap.
      setStepKey(initialStep && ORDER.includes(initialStep) ? initialStep : (firstMissingStep(flowFacts(f), ORDER) ?? 'final'))
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A step error belongs to its step: clear it whenever the step changes.
  useEffect(() => { setFlowError(null) }, [stepKey])

  // "Onboarding done" (owner, 15 Oct 2026): reaching the fee step or the last
  // screen asks the server to stamp it. The server checks every required step
  // itself (lib/onboardingDone) and stamps nothing while one is missing. Before
  // this, the new flow stamped only when a leave button was pressed — and a
  // tutor who went from the fee step to payment never pressed one.
  const completeSent = useRef(false)
  useEffect(() => {
    if ((stepKey === 'verify' || stepKey === 'final') && !completeSent.current) {
      completeSent.current = true
      void fetch('/api/tutor/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }) }).catch(() => { /* the server also stamps on save and on payment */ })
    }
  }, [stepKey])

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
    try { await fetch('/api/tutor/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }) }) } catch { /* leaving anyway */ }
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

  // The one missing-items list (lib/onboarding/missingItems) and the real
  // "visible on Google" rule (lib/seo/indexable), from this tutor's own facts.
  const checklist = missingSummary(flowFacts(facts) as FlowFacts)
  const indexFacts = { feePaid: facts.feePaid, cnicApproved: facts.cnicApproved, profilePicApproved: facts.photoApproved, selfieApproved: facts.selfieApproved }
  const indexReqs = tutorIndexRequirements(indexFacts)
  const google = { line: googleVisibilityLine(indexReqs), requirements: indexReqs, visible: tutorProfileIndexable(indexFacts) }

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
      {/* What is still to do, at the top of every step (owner, 13 Oct 2026):
          closed to one progress line until opened; "Fix now" jumps to the step. */}
      <WhatsMissing
        compact
        done={checklist.done}
        total={checklist.total}
        percent={checklist.percent}
        missing={checklist.missing}
        google={google}
        onFix={(item) => { setFlowError(null); setStepKey(item.step) }}
      />
      {opts.children}
    </StepShell>
  )

  // ---------- MOBILE FIRST (owner, 13 Oct 2026) ----------
  // A tutor who signed up with an email has no verified mobile yet. A verified
  // mobile is required, so it is asked for before the steps; the email itself
  // does not have to be confirmed to continue.
  if (!facts.phoneVerified && stepKey !== 'final' && stepKey !== 'contact') {
    return <MobileVerifyScreen facts={facts} smsAvailable={smsAvailable} shell={shell} onError={setFlowError}
      onVerified={async () => {
        const f = await refresh()
        if (f) setStepKey(firstMissingStep(flowFacts(f), ORDER) ?? 'final')
      }} />
  }

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
    return <SubjectsStep initialIds={facts.subjectIds} draft={facts.subjSel} shell={shell} helpWaHref={helpWaHref}
      onDraft={(sel) => setFacts((f) => (f ? { ...f, subjSel: sel } : f))}
      // Saved quietly while the tutor is still choosing (owner, 13 Oct 2026), so
      // leaving and coming back keeps the choices. A failure here says nothing:
      // "Next" saves again and reports properly.
      onAutoSave={async (ids) => {
        try {
          await saveProfile({ subjectMasterIds: ids })
          setFacts((f) => (f ? { ...f, subjectIds: ids } : f))
          return true
        } catch {
          return false
        }
      }}
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
      void leave(returnTo ?? '/tutor/dashboard')
      return <LogoLoader fullPage />
    }
    return <GetVerifiedStep stepTotal={ORDER.length} onBack={goBack} payFailed={payFailed} returnTo={returnTo} />
  }

  // ---------- FINAL ----------
  return (
    <StepShell heading="You're almost there" stepIndex={stepIndex} stepTotal={ORDER.length}
      onBack={goBack} backDisabled={false}
      buttonLabel={returnTo ? 'Back to the tuition' : 'Go to dashboard'} onNext={() => void leave(returnTo ?? '/tutor/dashboard')}>
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
// Rebuilt 13 Oct 2026 (owner): more tutors stopped here than at any other step.
// The rules are pure (lib/onboarding/levelRanges); this is only the screen.
//   • one search box — a subject typed once is found at every level, with the
//     platform's Search words and typo tolerance ("maths", "computer", "quran");
//   • quick picks — the commonest level + subject pairs, one tap each;
//   • level ranges — "Grade 1–5" selects all five grades; a grade can be
//     switched off again;
//   • what is chosen shows as removable chips; one level + one subject is enough;
//   • it saves as the tutor goes, so leaving and coming back keeps the choices.
function SubjectsStep({ initialIds, draft, shell, helpWaHref, onDraft, onAutoSave, onSave }: {
  initialIds: number[]; draft: RangeSelection; shell: ShellFn
  /** WhatsApp support link (app_settings), shown after 60s with nothing picked. */
  helpWaHref?: string | null
  onDraft: (sel: RangeSelection) => void
  /** Save quietly while the tutor is still choosing. Resolves true when saved. */
  onAutoSave: (ids: number[]) => Promise<boolean>
  onSave: (ids: number[]) => void
}) {
  const [tree, setTree] = useState<TaxonomyNode | null>(null)
  const [core, setCore] = useState<TaxonomyNode>({})
  // Short Urdu subject names (migration 149), shown under the English name.
  const [urdu, setUrdu] = useState<Record<string, string>>({})
  const [masters, setMasters] = useState<RangeMaster[]>([])
  const [sel, setSel] = useState<RangeSelection>(draft)
  const [q, setQ] = useState('')
  const [serverHits, setServerHits] = useState<string[]>([])
  const [moreLevels, setMoreLevels] = useState(false)
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({})
  const [tried, setTried] = useState(false)
  const [tooMany, setTooMany] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [helpVisible, setHelpVisible] = useState(false)
  const subjectWords = useSubjectWords()
  const touched = useRef(false)
  const lastSaved = useRef(initialIds.slice().sort((a, b) => a - b).join(','))

  // A tutor still on this step after 60 seconds gets a small WhatsApp help link
  // (shown only while nothing is picked).
  useEffect(() => {
    const t = setTimeout(() => setHelpVisible(true), 60_000)
    return () => clearTimeout(t)
  }, [])

  const ranges = useMemo(() => (tree ? levelRanges(tree) : []), [tree])

  useEffect(() => {
    let live = true
    void Promise.all([fetchTaxonomyTree(), fetchCoreTree(), fetchSubjectUrdu(), fetchNonLegacyMasters()])
      .then(([t, c, u, m]) => {
        if (!live) return
        setTree(t); setCore(c); setUrdu(u); setMasters(m)
        // First open with saved subjects and no draft yet: show them as chosen.
        if (Object.keys(draft).length === 0 && initialIds.length > 0) {
          const saved = selectionFromIds(initialIds, levelRanges(t), m)
          if (Object.keys(saved).length > 0) { setSel(saved); onDraft(saved) }
        }
      })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (next: RangeSelection) => { touched.current = true; setTried(false); setTooMany(false); setSel(next); onDraft(next) }

  // The platform's typo-tolerant + Roman-Urdu matching (/api/search/suggest —
  // "fizics" → Physics, "hisab" → Mathematics), debounced. Only its SUBJECT
  // rows are read: a school's name is never a subject.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { suggestions?: { group: string; label: string }[] } | null) => {
          setServerHits((j?.suggestions ?? []).filter((x) => x.group === 'subject').map((x) => x.label))
        })
        .catch(() => {})
    }, 250)
    return () => { ctrl.abort(); clearTimeout(t) }
  }, [q])

  // Save as they go: a moment after the last tap, once one level and one subject
  // are chosen. Leaving and coming back then finds the choices saved.
  useEffect(() => {
    if (!touched.current || masters.length === 0 || !canContinueSel(sel)) return
    const ids = resolveSelection(sel, ranges, masters)
    const key = ids.slice().sort((a, b) => a - b).join(',')
    if (ids.length === 0 || ids.length > TUTOR_SUBJECT_CAP || key === lastSaved.current) return
    const t = setTimeout(() => {
      void onAutoSave(ids).then((ok) => {
        if (!ok) return
        lastSaved.current = key
        setSavedNote(true)
      })
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, masters, ranges])

  const submit = () => {
    if (!canContinueSel(sel) || !tree) { setTried(true); return }
    const ids = resolveSelection(sel, ranges, masters)
    if (ids.length === 0) { setTried(true); return }
    if (ids.length > TUTOR_SUBJECT_CAP) { setTooMany(true); return }
    onSave(ids)
  }

  const picks = useMemo(() => (tree ? resolveQuickPicks(tree, core, ranges) : []), [tree, core, ranges])
  const hits = useMemo(() => (tree ? searchSubjects(q, tree, ranges, sel, subjectWords, q.trim().length >= 2 ? serverHits : []) : []), [q, tree, ranges, sel, subjectWords, serverHits])
  const chips = selectionChips(sel, ranges)
  const named = ranges.filter((r) => r.named)
  const others = ranges.filter((r) => !r.named)
  const chosen = ranges.filter((r) => sel[r.id])
  const counts = selectionCounts(sel)
  const SMALL = 'inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-xs font-bold transition-colors'

  return shell({
    onNext: submit,
    nextDisabled: !canContinueSel(sel),
    children: (
      <div className="space-y-4">
        {!tree ? (
          <ChipSkeletons count={8} />
        ) : (
          <>
            {/* What is chosen so far — tap a chip to remove it. */}
            {(chosen.length > 0 || chips.length > 0) && (
              <div className="space-y-1.5" aria-live="polite">
                <p className="text-[11px] font-bold text-gray-600">
                  {counts.levels} level{counts.levels === 1 ? '' : 's'} · {counts.subjects} subject{counts.subjects === 1 ? '' : 's'} chosen
                  {savedNote && <span className="font-semibold text-tm-green-deep"> · Saved</span>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map(({ range, subject }) => (
                    <button key={`${range.id}|${subject}`} type="button" onClick={() => update(toggleSubject(sel, range, subject))}
                      aria-label={`Remove ${subject} at ${range.label}`}
                      className={`${SMALL} border-tm-green-deep bg-tm-tint-green text-tm-green-deep`}>
                      {subject} · {range.label}<X size={12} aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* The ONE search box. */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a subject — maths, computer, quran" aria-label="Search a subject"
                  className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 pl-9 text-sm outline-none focus:border-tm-navy" />
              </div>
              {q.trim().length >= 2 && (
                hits.length > 0 ? (
                  <ul className="space-y-1.5">
                    {hits.map((h) => (
                      <li key={`${h.range.id}|${h.subject}`}>
                        <button type="button" aria-pressed={h.selected} onClick={() => update(toggleSubject(sel, h.range, h.subject))}
                          className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm font-bold transition-colors ${h.selected ? 'border-tm-green-deep bg-tm-tint-green text-tm-green-deep' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'}`}>
                          <span className="min-w-0 break-words">{h.subject} <span className="font-semibold text-gray-600">· {h.range.label}</span></span>
                          {h.selected ? <Check size={16} aria-hidden className="shrink-0" /> : <Plus size={16} aria-hidden className="shrink-0" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-xs text-gray-500">No subject matches “{q.trim()}”. Try another spelling, or pick a level below.</p>
                )
              )}
            </div>

            {/* Quick picks: a level and a subject in one tap. */}
            {picks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-gray-600">Quick picks</p>
                <div className="flex flex-wrap gap-2">
                  {picks.map((p) => (
                    <OChip key={p.pick.id} label={p.pick.label} selected={pickApplied(sel, p)} onClick={() => update(applyQuickPick(sel, p))} />
                  ))}
                </div>
              </div>
            )}

            {/* Level ranges: one tap takes every grade in the range. */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-gray-600">Levels you teach</p>
              <div className="flex flex-wrap gap-2">
                {[...named, ...(moreLevels ? others : others.filter((r) => sel[r.id]))].map((r) => (
                  <OChip key={r.id} label={r.label} selected={!!sel[r.id]} onClick={() => update(toggleRange(sel, r))} />
                ))}
                {others.length > 0 && (
                  <button type="button" aria-expanded={moreLevels} onClick={() => setMoreLevels((v) => !v)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-tm-navy px-4 text-sm font-bold text-tm-navy hover:bg-tm-tint-navy">
                    {moreLevels ? 'Fewer levels' : <><Plus size={14} aria-hidden />More levels</>}
                  </button>
                )}
              </div>
            </div>

            {/* One block per chosen level: its grades (each can be switched off)
                and its subjects — the main ones first, the rest behind "More". */}
            {chosen.map((range) => {
              const row = sel[range.id]
              const offered = subjectsOffered(tree, range, row.grades)
              const main = subjectsOffered(core, range, row.grades).filter((s) => offered.includes(s))
              for (const s of row.subjects) if (offered.includes(s) && !main.includes(s)) main.push(s)
              const rest = offered.filter((s) => !main.includes(s)).sort((a, b) => a.localeCompare(b))
              const open = main.length === 0 || !!moreOpen[range.id]
              return (
                <section key={range.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3">
                  <p className="text-sm font-black text-tm-navy">{range.label}</p>
                  {range.grades.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {range.grades.map((g) => {
                        const on = row.grades.includes(g)
                        return (
                          <button key={g} type="button" aria-pressed={on} onClick={() => update(toggleGrade(sel, range, g))}
                            className={`${SMALL} ${on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-tm-navy'}`}>
                            {on && <Check size={12} aria-hidden />}{g}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {main.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {main.map((sub) => (
                        <OChip key={sub} large label={sub} sub={urdu[sub]} selected={row.subjects.includes(sub)} onClick={() => update(toggleSubject(sel, range, sub))} />
                      ))}
                    </div>
                  )}
                  {main.length > 0 && rest.length > 0 && (
                    <button type="button" aria-expanded={open} onClick={() => setMoreOpen((m) => ({ ...m, [range.id]: !m[range.id] }))}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-tm-navy px-4 text-sm font-bold text-tm-navy hover:bg-tm-tint-navy">
                      {open ? 'Fewer subjects' : <><Plus size={14} aria-hidden />More subjects</>}
                    </button>
                  )}
                  {open && rest.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {rest.map((sub) => (
                        <OChip key={sub} large label={sub} sub={urdu[sub]} selected={false} onClick={() => update(toggleSubject(sel, range, sub))} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}

            {tried && !canContinueSel(sel) && (
              <p className="text-center text-[11px] font-bold text-tm-red">Choose a level and at least one subject.<span lang="ur" dir="rtl" className="block font-semibold text-gray-500">ایک جماعت اور کم از کم ایک مضمون منتخب کریں۔</span></p>
            )}
            {tooMany && (
              <p className="whitespace-pre-line text-center text-[11px] font-bold text-tm-red">{TOO_MANY_SUBJECTS}</p>
            )}
            {helpVisible && counts.subjects === 0 && helpWaHref && (
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
    // WhatsApp is a REQUIRED part of the contact step (lib/tutorFlow stepDone, PR86).
    // An empty box used to continue, which left the tutor unable to ever finish
    // onboarding (owner, 15 Oct 2026) — so Next waits for a valid number.
    onNext: () => { if (!waValid) return; void saveProfile({ profile: { whatsapp: normalisePkMobile(whatsapp) ?? whatsapp.trim() } }).then(() => next()).catch(() => onError('We couldn’t save that. Please try again.')) },
    nextDisabled: !waValid,
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
  // The crop step (owner, 11 Oct 2026): the member frames their face in the
  // circle; the photo and the framed square are both stored, the profile uses
  // the square.
  const { dialog, cropAndUpload } = usePhotoCropUpload()
  const [preview, setPreview] = useState<string | null>(current)
  const [uploading, setUploading] = useState(false)
  // An approved photo is LOCKED (owner, 17 Oct 2026); the Owner can unlock one change.
  const photoView = useDocLocks()?.photo ?? 'open'
  async function upload(file: File) {
    setUploading(true)
    try {
      const url = await cropAndUpload(file)
      if (!url) return
      setPreview(url); onSave(url)
      refreshDocLocks()
    } catch (e) { onError(e instanceof Error ? e.message : 'We couldn’t upload that photo. Please try again.') } finally { setUploading(false) }
  }
  return shell({
    onNext: () => {}, hideButton: !preview, nextDisabled: !preview,
    children: (
      <div className="space-y-2">
        {dialog}
        {photoView !== 'open' && <DocLockNotice view={photoView} doc="photo" />}
        {canPick(photoView) ? (
          <CaptureButtons facingMode="environment" busy={uploading} done={!!preview}
            preview={preview ? (<img src={preview} alt="Your photo" className="h-full w-full object-cover" />) : null} onPick={(f) => void upload(f)} />
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- the tutor's own approved photo
          <img src={preview} alt="Your photo" className="mx-auto h-32 w-32 rounded-2xl object-cover" />
        ) : null}
        {/* Hide my photo from parents (owner, 17 Oct 2026): off by default. */}
        <HidePhotoToggle />
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
  // An approved selfie is LOCKED (owner, 9 Oct 2026).
  const selfieView = useDocLocks()?.selfie ?? 'open'
  async function upload(file: File) {
    setUploading(true)
    try {
      const img = await compressUnder1MB(file)
      const body = new FormData(); body.append('kind', 'selfie'); body.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.previewUrl) throw new Error(data?.error || 'That photo could not be uploaded.')
      setPreview((old) => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      refreshDocLocks()
      toast.success('Selfie uploaded.')
    } catch (e) { onError(e instanceof Error ? e.message : 'We couldn’t upload that selfie. Please try again.') } finally { setUploading(false) }
  }
  return shell({
    onNext: onDone, nextDisabled: !uploaded,
    children: (
      <div className="space-y-2">
        {selfieView !== 'open' && <DocLockNotice view={selfieView} doc="selfie" />}
        {canPick(selfieView) && (
        <CaptureButtons facingMode="user" busy={uploading} done={uploaded}
          preview={preview ? (<img src={preview} alt="Your selfie" className="h-full w-full object-cover" />) : null} onPick={(f) => void upload(f)} />
        )}
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
  // An approved CNIC side is LOCKED (owner, 9 Oct 2026).
  const locks = useDocLocks()
  const view = (side === 'front' ? locks?.cnicFront : locks?.cnicBack) ?? 'open'
  async function upload(file: File) {
    setBusy(true)
    try {
      const img = await compressUnder1MB(file)
      const fd = new FormData(); fd.append('kind', 'cnic'); fd.append('label', side); fd.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.documentId) throw new Error(j.error ?? (res.status === 413 ? 'That photo was too large. Please try again.' : 'Upload failed.'))
      setPreview((old) => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      refreshDocLocks()
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'We couldn’t upload that. Please try again.') } finally { setBusy(false) }
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = '' }
  if (!canPick(view)) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-tm-navy">{label}</p>
        <div className="relative block aspect-[1.6] w-full overflow-hidden rounded-xl border border-gray-200 bg-tm-bg">
          {preview ? (<img src={preview} alt={label} className="h-full w-full object-cover" />) : null}
        </div>
        <DocLockNotice view={view} />
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-tm-navy">{label}</p>
      {view === 'unlocked' && <DocLockNotice view="unlocked" />}
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
// stepTotal) and there is no step after it. English only. The red button opens
// the CHOICE SCREEN (owner, 11 Oct 2026 — /pay/choose?plan=verified), where the
// tutor picks JazzCash (PayPro) or the other method; nothing is charged and no
// redirect happens from this screen. No CNIC card, no pay-later exit, no
// TutorVerifyGate, no Urdu and no amount on this screen.
// "What do I get?" opens the shared VerifyBenefitsDialog.

function GetVerifiedStep({ stepTotal, onBack, payFailed = false, returnTo = null }: {
  stepTotal: number; onBack: () => void; payFailed?: boolean
  /** The tuition the tutor came from, offered as a way back (owner, 15 Oct 2026). */
  returnTo?: string | null
}) {
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
          Verification Fee. We keep TutorMint clean of fake and spam accounts.
        </p>
        <Link href={payChoiceHref('verified', returnTo)}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-red px-6 text-sm font-bold text-white hover:bg-tm-red-hover">
          <CreditCard size={16} aria-hidden /> Get verified now
        </Link>
        <button type="button" onClick={() => setBenefits(true)}
          className="text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline">
          What do I get?
        </button>
        {returnTo && (
          <Link href={returnTo} className="block min-h-[44px] pt-2 text-xs font-bold text-tm-navy underline-offset-2 hover:underline">
            Back to the tuition
          </Link>
        )}
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
