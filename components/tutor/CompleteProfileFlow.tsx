'use client'

import { ArrowLeft, Camera, Check, CheckCircle2, Clock, Loader2, MessageCircle, Mail, Plus, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { compressImage, compressUnder1MB } from '@/lib/imageCompress'
import { useJobTitles } from '@/lib/jobTitles'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import { isSyntheticEmail } from '@/lib/phone'
import EmailCard from '@/components/account/EmailCard'
import { FormChecklist, ChecklistStatus } from '@/components/forms/FormChecklist'
import { checklistReady, type ChecklistItem } from '@/lib/formChecklist'
import CnicCapture, { cnicChecklistItems, type CnicCaptureState } from '@/components/identity/CnicCapture'
import { EXPERIENCE_BANDS, composeHeadline, composeBio, L, type OnboardingAnswers } from '@/lib/onboarding/copy'
import { FEE_MIN_DEFAULT, FEE_MAX_DEFAULT, validateFeeRange } from '@/lib/fee'
import type { OnboardingFacets } from '@/lib/openJobCounts'
import { fetchTaxonomyTree, resolveMasterIds, fetchNonLegacyMasters, type TaxonomyNode } from '@/lib/taxonomy'
import PhotoCaptureTile from '@/components/tutor/PhotoCaptureTile'
import TimeSlotGrid from '@/components/forms/TimeSlotGrid'
import { availabilityToSlots, slotsToAvailabilityList, type DaySlot } from '@/lib/timeSlots'
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
import { directoryBlockers, listingFixItems } from '@/lib/tutorListingStatus'

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

// Steps 1–6 and 10 are TUITION PREFERENCES (PR76 §C.2): they ask what work the
// tutor wants, and drive their default tuition feed, "Tuitions for you" and match
// notifications. So the wording is "…do you want to teach?", not "…do you teach?".
const TITLES: Record<FlowStepKey, string> = {
  city: 'Which city do you want tuitions in?',
  area: 'Which areas do you want tuitions in?',
  level: 'Which levels do you want to teach?',
  subjects: 'Which subjects do you want to teach?',
  jobtype: 'What kind of work do you want?',
  availability: 'When can you teach?',
  contact: 'Contact and about you',
  verify: 'Get verified',
  name: 'Your full name',
  photo: 'Add your photo',
  selfie: 'Take a selfie',
  experience: 'Years of experience',
  fee: 'What monthly fee do you expect?',
  degree: 'Your education and certificates',
  cnic: 'Your CNIC',
}

// The Urdu sub-label under each step title (owner PR5a §1.5), the way the
// previous new-tutor onboarding read. English on top, Urdu smaller beneath.
const URDU: Record<FlowStepKey, string> = {
  city: 'آپ کس شہر میں ٹیوشن چاہتے ہیں؟',
  area: 'آپ کن علاقوں میں ٹیوشن چاہتے ہیں؟',
  level: 'آپ کون سی جماعتیں پڑھانا چاہتے ہیں؟',
  subjects: 'آپ کون سے مضامین پڑھانا چاہتے ہیں؟',
  jobtype: 'آپ کس قسم کا کام چاہتے ہیں؟',
  availability: 'آپ کب پڑھا سکتے ہیں؟',
  contact: 'رابطہ اور آپ کے بارے میں',
  verify: 'تصدیق کروائیں',
  name: 'آپ کا پورا نام',
  photo: 'اپنی تصویر لگائیں',
  selfie: 'سیلفی لیں',
  experience: 'تجربے کے سال',
  fee: 'آپ کتنی ماہانہ فیس کی توقع رکھتے ہیں؟',
  degree: 'آپ کی تعلیم اور اسناد',
  cnic: 'آپ کا شناختی کارڈ',
}

type Props = {
  facets: OnboardingFacets | null
  support: { waHref: string | null; waDisplay: string | null; email: string | null }
  seed: string
  /** Whether a code can actually be delivered (owner PR5a §2.5). False → the
   *  mobile step says "SMS codes are not available yet" instead of pretending. */
  smsAvailable?: boolean
}

export default function CompleteProfileFlow({ facets, support, seed, smsAvailable = true }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { titles: jobTitles } = useJobTitles()
  const { map: cityMap } = useCityAreas()

  const [facts, setFacts] = useState<FlowFacts | null>(null)
  // The tutor's saved fee range prefills the fee step (defaults otherwise, PR67).
  const [feeInit, setFeeInit] = useState<{ min: number; max: number }>({ min: FEE_MIN_DEFAULT, max: FEE_MAX_DEFAULT })
  // The tutor's saved areas prefill the area step (PR68).
  const [areaInit, setAreaInit] = useState<string[]>([])
  // PR69: level-first subjects. The taxonomy tree (category → grade → subjects),
  // the picked categories ("levels") and the picked subjects per category.
  const [tree, setTree] = useState<TaxonomyNode | null>(null)
  const [selCats, setSelCats] = useState<string[]>([])
  const [selByCat, setSelByCat] = useState<Record<string, string[]>>({})
  // The tutor's saved availability slots prefill the availability step (PR69).
  const [availabilityInit, setAvailabilityInit] = useState<DaySlot[]>([])
  // "Show my picture to parents" (PR70). Default ON; a new tutor (no photo yet) is
  // the only one who reaches the photo step, so defaulting on is exactly right.
  const [showAvatar, setShowAvatar] = useState(true)
  // The tutor's actual saved subject master ids, so the subjects step preselects
  // them and a toggle EDITS the set rather than replacing it with one pick.
  const [subjectIds, setSubjectIds] = useState<number[]>([])
  // The number they signed up with (prefills the mobile step) and the CNIC
  // review state (for the final screen's CNIC-aware labels). Kept outside the
  // pure FlowFacts so the unit-tested type is untouched.
  const [phonePrefill, setPhonePrefill] = useState('')
  // PR78 §C: the contact step prefills WhatsApp and email from the profile.
  const [whatsappPrefill, setWhatsappPrefill] = useState('')
  const [emailPrefill, setEmailPrefill] = useState('')
  const [verificationState, setVerificationState] = useState<'none' | 'submitted' | 'approved' | 'rejected'>('none')
  const [stepKey, setStepKey] = useState<FlowStepKey | 'final' | null>(null)
  const [jobTypeDemand, setJobTypeDemand] = useState<Record<string, number>>({})
  // The Job Type chip order, FROZEN when the step opens (owner PR5a §1.3) so a
  // tap never reshuffles the chips. Set once on entering the jobtype step.
  const [jobOrder, setJobOrder] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  // PR78 §D.2: onboarded_at is stamped once the tutor reaches the LAST step (the
  // platform fee) or the final screen — i.e. every other step is answered
  // (photo/selfie/CNIC count as answered once uploaded, since they precede the
  // fee in the order). The fee step stays last until paid, but the tutor is no
  // longer force-routed back into onboarding. Fired once per session.
  const onboardedMarked = useRef(false)

  const deepLink = params.get('step')

  // The path+query to return to after login, so a deep link like
  // ?step=city survives the sign-in round trip (owner PR5a §1.6).
  const selfHref = useCallback(() => {
    const q = params.toString()
    return `/tutor/complete-profile${q ? `?${q}` : ''}`
  }, [params])

  const buildFacts = useCallback(async (): Promise<{
    facts: FlowFacts
    subjectIds: number[]
    phone: string
    whatsapp: string
    email: string
    verificationState: 'none' | 'submitted' | 'approved' | 'rejected'
  } | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(selfHref())}`)
      return null
    }
    const [{ data: p }, { data: tp }, subj, deg, self] = await Promise.all([
      supabase.from('profiles')
        .select('full_name, city, cnic_number, cnic_image_path, phone_verified_at, phone_number, whatsapp, email, verification_state, is_seed, is_team_account, is_banned, is_suspended')
        .eq('id', user.id).maybeSingle(),
      supabase.from('tutor_profiles')
        .select('city, area, gender, avatar_url, headline, bio, experience_years, hourly_rate_pkr, fee_min_pkr, fee_max_pkr, job_types, degrees, availability_list, video_youtube_id, video_status, verified_fee_paid_at, under_review, verification_status, imported, claimed_at')
        .eq('id', user.id).maybeSingle(),
      supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
      supabase.from('user_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('kind', 'degree'),
      supabase.from('user_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('kind', 'selfie'),
    ])
    const ids = (subj.data ?? []).map((r) => r.master_id as number)
    setAvailabilityInit(availabilityToSlots(tp?.availability_list))
    // Prefill the fee step from the saved range (PR67), falling back to the legacy
    // single fee, then the defaults.
    {
      const mn = (tp?.fee_min_pkr as number | null) ?? (tp?.hourly_rate_pkr as number | null)
      const mx = (tp?.fee_max_pkr as number | null) ?? (tp?.hourly_rate_pkr as number | null)
      setFeeInit({ min: mn ?? FEE_MIN_DEFAULT, max: mx ?? FEE_MAX_DEFAULT })
    }
    // Prefill the area step from the saved areas (PR68); fall back to the single
    // area. Fail-open if the table is not there yet (pre-migration).
    try {
      const { data: areaRows } = await supabase
        .from('tutor_areas')
        .select('area')
        .eq('tutor_id', user.id)
        .order('created_at')
      const list = (areaRows ?? []).map((r) => r.area as string).filter(Boolean)
      setAreaInit(list.length > 0 ? list : (tp?.area as string) ? [tp!.area as string] : [])
    } catch {
      setAreaInit((tp?.area as string) ? [tp!.area as string] : [])
    }
    // PR78 §D: the "No degree to add yet" marker. Read defensively so the flow
    // works before migration 119 is applied (column missing → false).
    let noDegreeYet = false
    try {
      const { data: nd } = await supabase
        .from('tutor_profiles')
        .select('no_degree_yet')
        .eq('id', user.id)
        .maybeSingle()
      noDegreeYet = !!(nd as { no_degree_yet?: boolean } | null)?.no_degree_yet
    } catch { /* pre-migration: no marker yet */ }

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
      selfieDone: (self.count ?? 0) > 0,
      availabilityCount: Array.isArray(tp?.availability_list) ? tp.availability_list.length : 0,
      phoneVerified: !!p?.phone_verified_at,
      feePaid: !!tp?.verified_fee_paid_at,
      noDegreeYet,
      isSeed: !!p?.is_seed,
      isTeamAccount: !!p?.is_team_account,
      isBanned: !!p?.is_banned,
      isSuspended: !!p?.is_suspended,
      underReview: !!tp?.under_review,
      verificationStatus: (tp?.verification_status as string) ?? null,
      imported: !!tp?.imported,
      claimedAt: (tp?.claimed_at as string) ?? null,
    }
    return {
      facts,
      subjectIds: ids,
      phone: (p?.phone_number as string) ?? '',
      whatsapp: (p?.whatsapp as string) ?? '',
      // A synthetic mobile-signup address is not a real inbox — do not prefill it.
      email: isSyntheticEmail((p?.email as string) ?? '') ? '' : ((p?.email as string) ?? ''),
      verificationState: ((p?.verification_state as 'none' | 'submitted' | 'approved' | 'rejected' | null) ?? 'none'),
    }
  }, [supabase, router, selfHref])

  // Initial load: build facts, open the deep-linked step or the first gap.
  useEffect(() => {
    let live = true
    void (async () => {
      const res = await buildFacts()
      if (!live || !res) return
      setFacts(res.facts)
      setSubjectIds(res.subjectIds)
      setPhonePrefill(res.phone)
      setWhatsappPrefill(res.whatsapp)
      setEmailPrefill(res.email)
      setVerificationState(res.verificationState)
      // PR69: prefill the level/subjects steps from the tutor's existing subjects,
      // grouped by EVERY category they teach (so a returning multi-category tutor
      // who re-opens the step and saves does not lose their other categories). A
      // new tutor starts empty; retired-taxonomy ids are not offered and are
      // re-picked on next edit (migration-80 policy).
      if (res.subjectIds.length > 0) {
        try {
          const masters = await fetchNonLegacyMasters()
          const byId = new Map(masters.map((m) => [m.id, m]))
          const cats: string[] = []
          const byCat: Record<string, string[]> = {}
          for (const id of res.subjectIds) {
            const m = byId.get(id)
            if (!m || !m.subject) continue
            if (!byCat[m.category]) { byCat[m.category] = []; cats.push(m.category) }
            if (!byCat[m.category].includes(m.subject)) byCat[m.category].push(m.subject)
          }
          if (live && cats.length > 0) {
            setSelCats(cats)
            setSelByCat(byCat)
          }
        } catch { /* start empty */ }
      }
      const dl = deepLink && (FLOW_ORDER as string[]).includes(deepLink) ? (deepLink as FlowStepKey) : null
      setStepKey(dl ?? firstMissingStep(res.facts) ?? 'final')
    })()
    // The taxonomy tree drives the level + subjects steps (PR69).
    void fetchTaxonomyTree().then((t) => { if (live) setTree(t) }).catch(() => {})
    fetch('/api/tutor/demand', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.jobTypeDemand) setJobTypeDemand(j.jobTypeDemand as Record<string, number>) })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stamp onboarded_at when the fee step (last) or the final screen is reached.
  useEffect(() => {
    if ((stepKey === 'verify' || stepKey === 'final') && !onboardedMarked.current) {
      onboardedMarked.current = true
      void fetch('/api/tutor/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true }),
      }).catch(() => { /* the sign-in gate also falls back to subjects+city */ })
    }
  }, [stepKey])

  const reload = useCallback(async () => {
    const res = await buildFacts()
    if (res) {
      setFacts(res.facts)
      setSubjectIds(res.subjectIds)
      setPhonePrefill(res.phone)
      setWhatsappPrefill(res.whatsapp)
      setEmailPrefill(res.email)
      setVerificationState(res.verificationState)
    }
    return res?.facts ?? null
  }, [buildFacts])

  // Keep ?step= in the URL in step with the current step (owner PR5a §1.1), via
  // replaceState (not a navigation) so refresh and browser Back land here. The
  // final screen carries ?step=final.
  useEffect(() => {
    if (!stepKey) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('step') === stepKey) return
    url.searchParams.set('step', stepKey)
    window.history.replaceState(window.history.state, '', url.toString())
  }, [stepKey])

  // Freeze the Job Type chip order when the step opens (owner PR5a §1.3). Set
  // once from the demand known at that moment; a tap never re-sorts, and a late
  // demand fetch never reshuffles what the tutor is already looking at.
  useEffect(() => {
    if (stepKey === 'jobtype') {
      setJobOrder((prev) => (prev ?? (jobTitles.length ? orderedTitles(jobTitles, jobTypeDemand) : null)))
    } else if (jobOrder !== null) {
      setJobOrder(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, jobTitles])

  // Advance to the next gap after the current step (skips filled), or the final
  // screen. Reloads facts first so a component-driven step (cnic, verify)
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

  // Availability (PR69 §3): written the SAME way Settings does — a direct,
  // RLS-scoped update of the tutor's own row (availability_list is not a
  // /api/profile/save whitelisted field), then patch facts and advance.
  const saveAvailability = useCallback(async (slots: DaySlot[]) => {
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Please sign in again.')
      // Slot-label shape (PR73): availability_list holds one {day, timeSlot:label}
      // per slot, so day+slot round-trips losslessly through the existing column.
      const { error } = await supabase.from('tutor_profiles').update({ availability_list: slotsToAvailabilityList(slots) }).eq('id', user.id)
      if (error) throw new Error(error.message)
      setAvailabilityInit(slots)
      const f = facts ? { ...facts, availabilityCount: slots.length } : facts
      if (f) setFacts(f)
      setBusy(false)
      if (f && stepKey && stepKey !== 'final') setStepKey(nextMissingAfter(f, stepKey) ?? 'final')
    } catch (e) {
      setBusy(false)
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    }
  }, [supabase, facts, stepKey, toast])

  // "Show my picture to parents" (PR70): a direct, RLS-scoped update of the
  // tutor's own row. Tolerant of the not-yet-applied migration — if the column
  // is missing, the local toggle still reflects the choice and the write is a
  // no-op that surfaces no error to a new tutor mid-onboarding.
  const saveShowAvatar = useCallback(async (value: boolean) => {
    setShowAvatar(value)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('tutor_profiles').update({ show_avatar: value }).eq('id', user.id)
    } catch { /* pre-migration or transient — the choice is kept locally */ }
  }, [supabase])

  // "No degree to add yet" (PR78 §D): the explicit Education answer. Marks the
  // step answered (migration 119) and advances. Tolerant of the not-yet-applied
  // migration — the local fact carries the answer for this session and the flow
  // advances either way (degree is not a listing blocker).
  const saveNoDegree = useCallback(async () => {
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.from('tutor_profiles').update({ no_degree_yet: true }).eq('id', user.id)
    } catch { /* pre-migration — advance anyway */ }
    const f = facts ? { ...facts, noDegreeYet: true } : facts
    if (f) setFacts(f)
    setBusy(false)
    if (f && stepKey && stepKey !== 'final') setStepKey(nextMissingAfter(f, stepKey) ?? 'final')
  }, [supabase, facts, stepKey])

  if (!facts || !stepKey) {
    return <div className="grid min-h-screen place-items-center text-xs font-bold text-gray-500">Loading…</div>
  }

  const isBlocker = stepKey !== 'final' && BLOCKER_STEPS.has(stepKey)
  // Skip is removed from every step (owner PR64 §A4); only the top "Later" link
  // lets a tutor leave the flow.
  const stepIndex = stepKey === 'final' ? FLOW_ORDER.length : FLOW_ORDER.indexOf(stepKey)

  // The tutor's own answers for the tagline/bio prefill (PR69): the picked
  // levels, the subjects across them, all areas, city and the experience band.
  const currentAnswers = (): OnboardingAnswers => ({
    city: facts?.city ?? null,
    areas: areaInit.length > 0 ? areaInit : facts?.area ? [facts.area] : [],
    subjectNames: Array.from(new Set(Object.values(selByCat).flat())),
    levelNames: selCats,
    // PR72 §C: the tagline is built from the tutor's job types (chosen at the
    // jobtype step, which comes before tagline in the flow order).
    jobTypes: facts?.jobTypes ?? [],
    experienceBand: EXPERIENCE_BANDS.find((b) => b.years === facts?.experienceYears)?.label ?? null,
  })

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col px-4 pb-28">
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
        {/* PR78 §D: no "Later"/"Skip" in onboarding. A tutor leaves via the site
            header/nav above this flow and returns to the first unanswered step
            (the gap flow); every step is answered by tapping. */}
      </header>

      <main className="flex-1 pt-6">
        {stepKey !== 'final' && (
          <div className="mb-5 text-center">
            <h1 className="text-xl font-black text-tm-navy">{TITLES[stepKey]}</h1>
            <p className="mt-0.5 text-xs text-gray-500" lang="ur" dir="rtl">
              {URDU[stepKey]}
            </p>
          </div>
        )}

        {stepKey === 'city' && (
          <ChipRow
            options={cityOptions(facets, cityMap.cities)}
            selected={facts.city}
            onPick={(name) => void tapSave({ profile: { city: name } }, { city: name })}
          />
        )}

        {/* Level first (PR69): pick the academic level(s); all grades are taken
            automatically. No per-grade picking. */}
        {stepKey === 'level' && (
          <LevelStep
            options={tree ? Object.keys(tree) : []}
            initial={selCats}
            busy={busy}
            onNext={(cats) => {
              setSelCats(cats)
              // Drop any picked subjects for a level that was unpicked.
              setSelByCat((m) => {
                const next: Record<string, string[]> = {}
                for (const c of cats) next[c] = m[c] ?? []
                return next
              })
              setStepKey('subjects')
            }}
          />
        )}

        {/* Subjects once per level (PR69): the union of the level's subjects,
            grouped by level, saved for every grade where the subject exists. */}
        {stepKey === 'subjects' && (
          <div className="space-y-4">
            <OpenTuitionCount city={facts.city} national={facets?.national ?? null} />
            <SubjectsPerLevelStep
              tree={tree}
              cats={selCats.length > 0 ? selCats : tree ? Object.keys(tree).slice(0, 0) : []}
              selByCat={selByCat}
              busy={busy}
              onChange={setSelByCat}
              onBackToLevel={() => setStepKey('level')}
              onNext={async () => {
                if (!tree) return
                // Resolve to master ids: each picked subject × every grade in its
                // level where the taxonomy has it (resolveMasterIds does exactly this).
                const all: number[] = []
                for (const cat of selCats) {
                  const grades = Object.keys(tree[cat] ?? {})
                  const subs = selByCat[cat] ?? []
                  if (subs.length === 0) continue
                  const ids = await resolveMasterIds(cat, grades, subs)
                  all.push(...ids)
                }
                const ids = Array.from(new Set(all))
                try {
                  await saveProfile({ subjectMasterIds: ids })
                  setSubjectIds(ids)
                  const f = facts ? { ...facts, subjectCount: ids.length } : facts
                  if (f) {
                    setFacts(f)
                    setStepKey(nextMissingAfter(f, 'subjects') ?? 'final')
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not save.')
                }
              }}
            />
          </div>
        )}

        {/* Availability (PR69): the same editor as Settings. PR78 §D removed the
            "Later" skip — the tutor picks at least one slot to continue. */}
        {stepKey === 'availability' && (
          <AvailabilityStep
            initial={availabilityInit}
            busy={busy}
            onNext={(slots) => void saveAvailability(slots)}
          />
        )}

        {stepKey === 'jobtype' && (
          <MultiChipRow
            options={jobOrder ?? orderedTitles(jobTitles, jobTypeDemand)}
            selected={facts.jobTypes}
            onToggle={(next) =>
              void saveProfile({ tutorProfile: { job_types: next, teaching_mode: next[0] ?? null } })
                .then(() => setFacts((f) => (f ? { ...f, jobTypes: next } : f)))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save.'))
            }
          />
        )}

        {stepKey === 'area' && (
          <AreaMultiStep
            options={areaOptions(facets, cityMap, facts.city).map((o) => o.name)}
            initial={areaInit}
            busy={busy}
            onNext={(areas) => void tapSave({ areas, profile: { city: facts.city } }, { area: areas[0] ?? null })}
          />
        )}

        {stepKey === 'experience' && (
          <div className="flex flex-wrap justify-center gap-2">
            {EXPERIENCE_BANDS.map((b) => (
              <Chip
                key={b.label}
                // PR78 §D: the lowest band reads "New to teaching" (an explicit
                // answer), not "0–1 years".
                label={b.years === 0 ? 'New to teaching' : `${b.label} years`}
                selected={false}
                onClick={() => void tapSave({ tutorProfile: { experience_years: b.years } }, { experienceYears: b.years })}
              />
            ))}
          </div>
        )}

        {/* PR78 §C — "Contact and about you" on ONE screen: mobile (verified /
            verify-by-SMS), WhatsApp, email, gender, tagline and bio. */}
        {stepKey === 'contact' && (
          <ContactStep
            support={support}
            smsAvailable={smsAvailable}
            phoneVerified={facts.phoneVerified}
            phone={phonePrefill}
            gender={facts.gender}
            whatsappInit={whatsappPrefill}
            headlineInit={facts.headline ?? composeHeadline(currentAnswers())}
            bioInit={facts.bio ?? composeBio(currentAnswers(), seed)}
            emailConfirmed={!!emailPrefill}
            busy={busy}
            onGender={(g) => void tapSave({ tutorProfile: { gender: g } }, { gender: g })}
            onMobileVerified={() => setFacts((f) => (f ? { ...f, phoneVerified: true } : f))}
            onContinue={(v) =>
              void tapSave(
                { tutorProfile: { headline: v.headline, bio: v.bio }, profile: { whatsapp: v.whatsapp } },
                { headline: v.headline, bio: v.bio },
              )
            }
          />
        )}

        {stepKey === 'verify' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            {/* PR78 §D: no "Not now" here — the fee step is the last step and
                stays until paid; the tutor leaves via the site nav if needed. */}
            <TutorVerifyGate onClose={() => void advance()} showDismiss={false} />
          </div>
        )}

        {stepKey === 'photo' && (
          <div className="space-y-4">
            <PhotoStep
              seed={seed}
              currentUrl={facts.avatarUrl}
              onUploaded={(url) => void tapSave({ tutorProfile: { avatar_url: url } }, { avatarUrl: url })}
            />
            <PictureNote />
            <ShowAvatarToggle value={showAvatar} onChange={(v) => void saveShowAvatar(v)} />
          </div>
        )}

        {/* Selfie (PR70 §5): a verification selfie, reusing the Settings upload
            (front camera, private bucket, sets the selfie status to pending).
            PR78 §D removed the "Later" skip — it is uploaded, not skipped. */}
        {stepKey === 'selfie' && (
          <SelfieStep done={facts.selfieDone} onDone={() => void advance()} />
        )}

        {stepKey === 'name' && (
          <TextStep
            initial={facts.fullName ?? ''} placeholder="Your full name"
            onNext={(v) => void tapSave({ profile: { full_name: v } }, { fullName: v })}
            busy={busy}
          />
        )}
        {stepKey === 'fee' && (
          <FeeRangeStep
            initialMin={feeInit.min}
            initialMax={feeInit.max}
            busy={busy}
            onNext={(min, max) => void tapSave({ tutorProfile: { fee_min_pkr: min, fee_max_pkr: max } }, { hourlyRate: min })}
          />
        )}

        {stepKey === 'degree' && (
          <div className="space-y-4">
            <DegreeStep onSaved={() => void advance()} />
            {/* PR78 §D: an explicit answer instead of a skip. A degree is not a
                listing requirement (it gates only the Verified badge), so "none
                yet" is a valid answer; the tutor can add one later from Settings. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveNoDegree()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy disabled:opacity-40"
            >
              No degree to add yet
              <span lang="ur" dir="rtl" className="ms-2 text-gray-500">— ابھی کوئی ڈگری نہیں</span>
            </button>
          </div>
        )}
        {stepKey === 'cnic' && <CnicFlowStep onSubmitted={() => void advance()} />}

        {stepKey === 'final' && <FinalScreen facts={facts} onLeave={leave} />}
      </main>

      {/* footer */}
      {stepKey !== 'final' && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-md items-center gap-3">
            {/* PR78 §D: no Skip/Later. The site header/nav (above this flow) is
                the way out; the gap flow resumes at the first unanswered step.
                The component-driven steps advance from their own callback; the
                rest advance on this button. Blockers require the step done. */}
            {!['contact', 'verify', 'cnic', 'degree', 'photo', 'selfie', 'name', 'fee', 'area', 'level', 'subjects', 'availability'].includes(stepKey) && (
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

// The live open-tuition count for the subjects step (owner PR5a §1.5). Queries
// /api/onboarding/counts for the tutor's city; falls back to the national count
// when the city has fewer than 3 open (the floor rule — never a lonely number).
function OpenTuitionCount({ city, national }: { city: string | null; national: number | null }) {
  const [scoped, setScoped] = useState<{ national: number; city: number | null } | null>(
    national != null ? { national, city: null } : null,
  )
  useEffect(() => {
    let live = true
    fetch('/api/onboarding/counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: city ?? null }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setScoped({ national: j.national ?? 0, city: j.city ?? null }) })
      .catch(() => {})
    return () => { live = false }
  }, [city])

  if (!scoped || scoped.national <= 0) return null
  const cityEnough = city && scoped.city != null && scoped.city >= 3
  const n = cityEnough ? (scoped.city as number) : scoped.national
  const where = cityEnough ? `in ${city}` : 'across Pakistan'
  return (
    <p className="rounded-xl bg-tm-tint-green px-3 py-2 text-center text-xs font-bold text-tm-green-deep">
      {n.toLocaleString('en-PK')} {n === 1 ? 'tuition' : 'tuitions'} open {where}
    </p>
  )
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

// The fee step (PR67 §2): Minimum and Maximum monthly-fee fields, prefilled and
// editable, with a plain bilingual error when the minimum is above the maximum.
function FeeRangeStep({
  initialMin,
  initialMax,
  busy,
  onNext,
}: {
  initialMin: number
  initialMax: number
  busy: boolean
  onNext: (min: number, max: number) => void
}) {
  const [min, setMin] = useState(String(initialMin))
  const [max, setMax] = useState(String(initialMax))
  const [error, setError] = useState<{ en: string; ur: string } | null>(null)
  const parse = (s: string): number | null => {
    const digits = s.replace(/[^\d]/g, '')
    if (digits === '') return null
    const n = Number(digits)
    return Number.isFinite(n) ? n : null
  }
  const submit = () => {
    const mn = parse(min)
    const mx = parse(max)
    const err = validateFeeRange(mn, mx)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    onNext(mn as number, mx as number)
  }
  const field = (
    label: string,
    labelUr: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
  ) => (
    <label className="space-y-1">
      <span className="block text-xs font-bold text-tm-navy">{label}</span>
      <span className="block text-right text-[11px] text-gray-500" lang="ur" dir="rtl">{labelUr}</span>
      <input
        value={value}
        inputMode="numeric"
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy"
      />
    </label>
  )
  // Self-explaining checklist (PR80). Item 2's "done" IS the server rule
  // (validateFeeRange null = both present, positive, min ≤ max), so the gate never
  // diverges from validation.
  const items: ChecklistItem[] = [
    { en: 'Enter your minimum monthly fee', ur: 'اپنی کم از کم ماہانہ فیس درج کریں', done: (parse(min) ?? 0) > 0 },
    { en: 'Enter a maximum that is at least the minimum', ur: 'کم از کم کے برابر یا زیادہ حد درج کریں', done: validateFeeRange(parse(min), parse(max)) === null },
  ]
  const ready = checklistReady(items)
  return (
    <div className="space-y-4">
      <FormChecklist items={items} />
      <div className="grid grid-cols-2 gap-3">
        {field('Minimum', 'کم از کم', min, setMin, String(FEE_MIN_DEFAULT))}
        {field('Maximum', 'زیادہ سے زیادہ', max, setMax, String(FEE_MAX_DEFAULT))}
      </div>
      <div>
        <p className="text-[11px] text-gray-500">Rupees per month, whole numbers.</p>
        <p className="text-right text-[11px] text-gray-500" lang="ur" dir="rtl">ماہانہ فیس، پورے روپوں میں۔</p>
      </div>
      {error && (
        <div role="alert" className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-2.5">
          <p className="text-xs font-bold text-tm-red">{error.en}</p>
          <p className="text-right text-[11px] font-semibold text-tm-red" lang="ur" dir="rtl">{error.ur}</p>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !ready}
        onClick={submit}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
      <ChecklistStatus items={items} />
    </div>
  )
}

// The area step (PR68 §2): multi-select with the same search + chips, at least one
// area required. All areas are within the tutor's chosen city (the options are the
// city's areas). Its own Save & continue advances (the footer Next is disabled for
// this step).
function AreaMultiStep({
  options,
  initial,
  busy,
  onNext,
}: {
  options: string[]
  initial: string[]
  busy: boolean
  onNext: (areas: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  // Keep any already-selected areas visible even if not in the (search-filtered) list.
  const shown = query ? options.filter((o) => o.toLowerCase().includes(query)).slice(0, 40) : options
  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))
  const items: ChecklistItem[] = [
    { en: 'Choose at least one area', ur: 'کم از کم ایک علاقہ منتخب کریں', done: selected.length > 0 },
  ]
  return (
    <div className="space-y-4">
      <FormChecklist items={items} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        aria-label="Search areas"
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-tm-navy"
      />
      {selected.length > 0 && (
        <p className="text-center text-[11px] font-bold text-tm-green-deep">
          {selected.length} selected · {selected.join(', ')}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {Array.from(new Set([...selected, ...shown])).map((name) => (
          <Chip key={name} label={name} selected={selected.includes(name)} onClick={() => toggle(name)} />
        ))}
      </div>
      <button
        type="button"
        disabled={busy || selected.length === 0}
        onClick={() => onNext(selected)}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
      <ChecklistStatus items={items} />
    </div>
  )
}

// Level first (PR69 §1): pick the academic level(s) only. Its own Save & continue.
function LevelStep({
  options,
  initial,
  busy,
  onNext,
}: {
  options: string[]
  initial: string[]
  busy: boolean
  onNext: (cats: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const shown = query ? options.filter((o) => o.toLowerCase().includes(query)) : options
  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))
  const items: ChecklistItem[] = [
    { en: 'Choose at least one level', ur: 'کم از کم ایک جماعت منتخب کریں', done: selected.length > 0 },
  ]
  return (
    <div className="space-y-4">
      {options.length === 0 ? (
        <p className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Loading levels…
        </p>
      ) : (
        <>
          <FormChecklist items={items} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search levels"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-tm-navy"
          />
          {selected.length > 0 && (
            <p className="text-center text-[11px] font-bold text-tm-green-deep">{selected.join(', ')}</p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {Array.from(new Set([...selected, ...shown])).map((name) => (
              <Chip key={name} label={name} selected={selected.includes(name)} onClick={() => toggle(name)} />
            ))}
          </div>
          <button
            type="button"
            disabled={busy || selected.length === 0}
            onClick={() => onNext(selected)}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
          >
            {busy ? '…' : 'Save & continue'}
          </button>
          <ChecklistStatus items={items} />
        </>
      )}
    </div>
  )
}

// Subjects once per level (PR69 §2): the union of the level's subjects, grouped
// per level, multi-select with search. Saving resolves each to every grade.
function SubjectsPerLevelStep({
  tree,
  cats,
  selByCat,
  busy,
  onChange,
  onBackToLevel,
  onNext,
}: {
  tree: TaxonomyNode | null
  cats: string[]
  selByCat: Record<string, string[]>
  busy: boolean
  onChange: (next: Record<string, string[]>) => void
  onBackToLevel: () => void
  onNext: () => void
}) {
  const [q, setQ] = useState('')
  if (!tree || cats.length === 0) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-gray-500">Choose a level first, then its subjects appear here.</p>
        <button
          type="button"
          onClick={onBackToLevel}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-bold text-tm-navy"
        >
          Choose a level
        </button>
      </div>
    )
  }
  const query = q.trim().toLowerCase()
  const groups = cats.map((cat) => {
    const grades = Object.keys(tree[cat] ?? {})
    const subs = Array.from(new Set(grades.flatMap((g) => tree[cat][g] ?? []))).sort()
    return { cat, subs: query ? subs.filter((s) => s.toLowerCase().includes(query)) : subs }
  })
  const total = Object.values(selByCat).reduce((n, arr) => n + arr.length, 0)
  const toggle = (cat: string, sub: string) => {
    const cur = selByCat[cat] ?? []
    onChange({ ...selByCat, [cat]: cur.includes(sub) ? cur.filter((x) => x !== sub) : [...cur, sub] })
  }
  const items: ChecklistItem[] = [
    { en: 'Choose at least one subject', ur: 'کم از کم ایک مضمون منتخب کریں', done: total > 0 },
  ]
  return (
    <div className="space-y-4">
      <FormChecklist items={items} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a subject…"
        aria-label="Search subjects"
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-tm-navy"
      />
      {groups.map((g) => (
        <div key={g.cat} className="space-y-2">
          {cats.length > 1 && <p className="text-[11px] font-bold text-gray-500">{g.cat}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {g.subs.map((sub) => (
              <Chip
                key={`${g.cat}:${sub}`}
                label={sub}
                selected={(selByCat[g.cat] ?? []).includes(sub)}
                onClick={() => toggle(g.cat, sub)}
              />
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={busy || total === 0}
        onClick={onNext}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
      <ChecklistStatus items={items} />
    </div>
  )
}

// Availability (PR69 §3): the same day/time editor as Settings. Save & continue is
// enabled once a slot is added; without slots the tutor continues only via "Later".
// PR73 §A: the shared 7×3 time-slot grid, replacing the free-text day/time rows.
function AvailabilityStep({
  initial,
  busy,
  onNext,
}: {
  initial: DaySlot[]
  busy: boolean
  onNext: (slots: DaySlot[]) => void
}) {
  const [slots, setSlots] = useState<DaySlot[]>(initial)
  const items: ChecklistItem[] = [
    { en: 'Pick at least one time you can teach', ur: 'کم از کم ایک وقت منتخب کریں جب آپ پڑھا سکیں', done: slots.length > 0 },
  ]
  return (
    <div className="space-y-4">
      <FormChecklist items={items} />
      <TimeSlotGrid value={slots} onChange={setSlots} disabled={busy} />
      {/* PR78 §D: no "Later" — the tutor picks at least one slot to continue. */}
      <button
        type="button"
        disabled={busy || slots.length === 0}
        onClick={() => onNext(slots)}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-30"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
      <ChecklistStatus items={items} />
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

// The shared picture/selfie instruction (PR70 §4). English over Urdu, the same
// style as every other step's sub-label.
function PictureNote() {
  return (
    <div className="rounded-xl bg-tm-tint-navy p-3">
      <p className="text-[11px] leading-relaxed text-tm-navy">{L.pictureNote.en}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-tm-navy" lang="ur" dir="rtl">{L.pictureNote.ur}</p>
    </div>
  )
}

// "Show my picture to parents" (PR70 §2). Default on; off shows a "Hidden from
// parents" note. English label with Urdu beneath.
function ShowAvatarToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-tm-navy">{L.showAvatar.en}</span>
          <span className="block text-[11px] text-gray-500" lang="ur" dir="rtl">{L.showAvatar.ur}</span>
        </span>
        <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${value ? 'bg-tm-green-deep' : 'bg-gray-300'}`}>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </span>
      </button>
      {!value && (
        <p className="mt-2 text-[11px] font-bold text-tm-gold-ink">
          {L.hiddenFromParents.en} — <span lang="ur" dir="rtl">{L.hiddenFromParents.ur}</span>
        </p>
      )}
    </div>
  )
}

// The onboarding selfie step (PR70 §5): the same front-camera upload as Settings
// (private bucket, sets the selfie status to pending), plus the shared note.
// PR78 §D: no "Later" — the selfie is uploaded to continue.
function SelfieStep({ done, onDone }: { done: boolean; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const uploaded = done || !!preview

  async function upload(file: File) {
    setBusy(true)
    try {
      const img = await compressUnder1MB(file)
      const body = new FormData()
      body.append('kind', 'selfie')
      body.append('file', img)
      const res = await fetch('/api/documents/upload', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.previewUrl) throw new Error(data?.error || 'That photo could not be uploaded. Try a JPG or PNG.')
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      toast.success('Selfie uploaded.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the selfie.')
    } finally {
      setBusy(false)
    }
  }

  const items: ChecklistItem[] = [
    { en: 'Take a selfie', ur: 'ایک سیلفی لیں', done: uploaded },
  ]
  return (
    <div className="space-y-4">
      <FormChecklist items={items} />
      <PictureNote />
      <div className="mx-auto w-40">
        <PhotoCaptureTile
          facingMode="user"
          aspectClass="aspect-square"
          label={uploaded ? 'Selfie added' : 'Selfie'}
          ariaLabel="your verification selfie"
          busy={busy}
          done={uploaded}
          preview={
            preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Your verification selfie" className="h-full w-full object-cover" />
            ) : null
          }
          onPick={(f) => void upload(f)}
        />
      </div>
      <button
        type="button"
        disabled={busy || !uploaded}
        onClick={onDone}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
      <ChecklistStatus items={items} />
    </div>
  )
}

function DegreeStep({ onSaved }: { onSaved: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const uploaded = !!preview

  async function uploadCert(file: File) {
    setUploading(true)
    try {
      // Compressed under 1 MB for BOTH the camera and the gallery path (§3).
      const img = await compressUnder1MB(file)
      const fd = new FormData()
      fd.append('kind', 'degree'); fd.append('file', img); fd.append('label', title.trim() || 'Degree certificate')
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Upload failed.')
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(img) })
      toast.success('Certificate uploaded.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload.')
    } finally {
      setUploading(false)
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

  // Self-explaining checklist (PR80) — mirrors save(): a degree title + a
  // certificate image. (The "No degree to add yet" answer is a separate button
  // rendered by the flow, outside this sub-form.)
  const items: ChecklistItem[] = [
    { en: 'Type your degree', ur: 'اپنی ڈگری لکھیں', done: !!title.trim() },
    { en: 'Add a photo of the certificate', ur: 'سند کی تصویر لگائیں', done: uploaded },
  ]
  const ready = checklistReady(items)
  return (
    <div className="space-y-4">
      <FormChecklist items={items} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Degree, e.g. BSc Physics — Punjab University"
        className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy" />
      {/* Camera OR gallery — the shared tile (§3). */}
      <div className="mx-auto w-40">
        <PhotoCaptureTile
          facingMode="environment"
          aspectClass="aspect-[1.4]"
          label={uploaded ? 'Certificate added' : 'Certificate'}
          ariaLabel="your degree certificate"
          busy={uploading}
          done={uploaded}
          preview={
            preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Certificate preview" className="h-full w-full object-cover" />
            ) : null
          }
          onPick={(f) => void uploadCert(f)}
        />
      </div>
      <p className="text-[11px] text-gray-500">Only you and our verification team can see it. Previews are watermarked.</p>
      <button type="button" disabled={busy || !ready} onClick={() => void save()}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40">
        {busy ? '…' : 'Save & continue'}
      </button>
      <ChecklistStatus items={items} />
    </div>
  )
}

// The in-flow CNIC step (owner PR5a §1.4): the CNIC number field + the two
// shared camera tiles + ONE "Save & continue" that saves the number, (the tiles
// have already uploaded both sides) and submits for checking — then the
// "Being checked" state with a Continue button. Settings keeps the FULL identity
// card; this is the slim in-flow version so a tutor is not shown a second
// "Identity documents" heading and three separate buttons mid-flow.
function CnicFlowStep({ onSubmitted }: { onSubmitted: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Prefill from any earlier attempt so a returning tutor is not asked twice, then
  // the shared CnicCapture owns the number/photos/checklist.
  const [prefill, setPrefill] = useState<{ number: string; front: boolean; back: boolean } | null>(null)
  const [cap, setCap] = useState<CnicCaptureState | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/identity', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return
        const id = j?.identity
        const number = (id?.cnicNumber as string) ?? ''
        const front = id?.front != null
        const back = id?.back != null
        setPrefill({ number, front, back })
        if (id) {
          // ONE CNIC status (PR66 §4): approved only with the number AND both
          // images; otherwise it is still being checked.
          const hasDocs = !!number.trim() && front && back
          if (id.state === 'approved' && hasDocs) setApproved(true)
          else if (id.state === 'submitted' || id.state === 'approved') setSubmitted(true)
        }
      })
      .catch(() => setPrefill({ number: '', front: false, back: false }))
    return () => { live = false }
  }, [])

  async function saveAndContinue() {
    if (!cap?.ready) return
    setError(null)
    setBusy(true)
    try {
      // Re-save the current number (idempotent — CnicCapture already saved it on
      // upload), then submit for checking. Same /api/identity endpoints as before.
      const num = await fetch('/api/identity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-number', cnicNumber: cap.number }),
      })
      if (!num.ok) { setError((await num.json().catch(() => ({}))).error ?? 'Could not save your CNIC number.'); return }
      const res = await fetch('/api/identity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit' }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not submit for checking.'); return }
      setSubmitted(true)
      toast.success('CNIC sent for checking.')
    } finally {
      setBusy(false)
    }
  }

  if (approved) {
    return (
      <div className="space-y-5 pt-4 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-tm-tint-green text-tm-green-deep">
          <CheckCircle2 size={30} aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-black text-tm-navy">CNIC verified</p>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-gray-500">
            Your card has been approved.
          </p>
        </div>
        <button
          type="button"
          onClick={onSubmitted}
          className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white"
        >
          Continue
        </button>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="space-y-5 pt-4 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-tm-tint-gold text-tm-gold-ink">
          <Clock size={30} aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-black text-tm-navy">CNIC being checked</p>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-gray-500">
            Our team is reviewing your card. You can carry on with your profile.
          </p>
        </div>
        <button
          type="button" onClick={onSubmitted}
          className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white"
        >
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* The ONE shared CNIC entry (PR81): number + auto-dashes + front/back tiles
          + the numbered checklist. This step keeps its own submit (save-number +
          /api/identity submit) and its being-checked/verified states. */}
      {prefill && (
        <CnicCapture
          initialNumber={prefill.number}
          initialFront={prefill.front}
          initialBack={prefill.back}
          onState={setCap}
        />
      )}
      {error && <p role="alert" className="text-[11px] font-bold text-tm-red">{error}</p>}
      <button
        type="button" disabled={busy || !cap?.ready} onClick={() => void saveAndContinue()}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40"
      >
        {busy ? '…' : 'Save & continue'}
      </button>
      {cap && <ChecklistStatus items={cnicChecklistItems(cap)} />}
    </div>
  )
}

function SupportBox({ support, title }: { support: { waHref: string | null; waDisplay: string | null; email: string | null }; title: string }) {
  if (!support.waHref && !support.email) return null
  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-bold text-tm-navy">{title}</p>
      {/* The support number in plain text — public, and quicker to read or dial
          than to open a link (§4.3). */}
      {support.waDisplay && (
        <p className="text-[11px] font-bold text-tm-navy">WhatsApp {support.waDisplay}</p>
      )}
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
  )
}

// The mobile-verification step. Codes go by SMS. Prefilled with the signup
// number; 03XXXXXXXXX is accepted and /api/auth/otp normalises it.
//
// PR16 §3 — ONE CODE, NO RESEND, NO COUNTDOWN, NO SELF-SERVICE NUMBER CHANGE.
// After Send, the code field + Verify + the support fallback (WhatsApp
// 0321 5872222). Five wrong attempts lock the code and the server returns the
// "contact support" message. To change the number, contact support (§3.2). If no
// SMS provider is configured, it says so plainly rather than pretending to send.
function MobileStep({
  support,
  initialPhone,
  smsAvailable,
  onVerified,
}: {
  support: { waHref: string | null; waDisplay: string | null; email: string | null }
  initialPhone: string
  smsAvailable: boolean
  onVerified: () => void
}) {
  const toast = useToast()
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (initialPhone) setPhone((p) => p || initialPhone) }, [initialPhone])

  async function send() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', phone }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error ?? 'Could not send the code.'); return }
      setSent(true)
      toast.success(j.alreadySent ? 'We already sent a code to this number. Please use it.' : 'Code sent by SMS.')
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

  // Nothing configured to deliver a code. Say so; do not pretend to send.
  if (!smsAvailable) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-tm-tint-gold px-3 py-3 text-center text-xs font-bold text-tm-gold-ink">
          SMS codes are not available yet. Please contact support to verify your number.
        </p>
        <SupportBox support={support} title="Verify with our team" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-center text-[11px] leading-relaxed text-gray-500">
        We&rsquo;ll send a 6-digit code to this number by SMS.
      </p>
      <p className="text-center text-[11px] leading-relaxed text-gray-500" lang="ur" dir="rtl">
        ہم اس نمبر پر ایس ایم ایس کے ذریعے 6 ہندسوں کا کوڈ بھیجیں گے۔
      </p>
      <input
        value={phone} inputMode="tel" readOnly={sent} onChange={(e) => setPhone(e.target.value)}
        placeholder="0300 1234567" aria-label="Mobile number"
        className={`min-h-[48px] w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-tm-navy ${sent ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}
      />
      {!sent ? (
        <button type="button" disabled={busy || !phone} onClick={() => void send()}
          className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40">
          {busy ? '…' : 'Send code'}
        </button>
      ) : (
        <>
          <input value={otp} inputMode="numeric" autoComplete="one-time-code" onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
            className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-center text-lg font-black tracking-widest outline-none focus:border-tm-navy" />
          <button type="button" disabled={busy || otp.length < 6} onClick={() => void verify()}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-4 text-sm font-black text-white disabled:opacity-40">
            <ShieldCheck size={16} aria-hidden /> Verify
          </button>
          {/* PR17 §3.1 — while the number is not yet verified the tutor can enter a
              different one; sending to the new number cancels the old code. No
              resend to the SAME number (one code, no countdown). */}
          <button type="button" onClick={() => { setSent(false); setOtp('') }}
            className="flex min-h-[44px] w-full items-center justify-center px-1 text-xs font-bold text-tm-navy hover:underline">
            Use a different number
          </button>
          {/* The support fallback if the code was lost or the number is locked. */}
          <SupportBox support={support} title="No code arriving?" />
        </>
      )}
    </div>
  )
}

// A field label: English with the Urdu beneath it (PR78 §C, English + Urdu).
function FieldLabel({ en, ur }: { en: string; ur: string }) {
  return (
    <div>
      <span className="text-xs font-bold text-tm-navy">{en}</span>
      <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">{ur}</span>
    </div>
  )
}

// PR78 §C — "Contact and about you" on ONE screen. Mobile (verified read-only, or
// verify-by-SMS via the shared MobileStep), WhatsApp (optional + "Same as my
// mobile"), email (optional, EmailCard's confirm-by-link flow, or "I don't use
// email"), gender, tagline and bio. Required to continue: a verified mobile,
// gender, tagline and bio (WhatsApp and email are optional). Saves use the same
// paths as the old separate steps (gender on tap; whatsapp/headline/bio on
// Continue via /api/profile/save; email via EmailCard).
function ContactStep({
  support,
  smsAvailable,
  phoneVerified,
  phone,
  gender,
  whatsappInit,
  headlineInit,
  bioInit,
  emailConfirmed,
  busy,
  onGender,
  onMobileVerified,
  onContinue,
}: {
  support: { waHref: string | null; waDisplay: string | null; email: string | null }
  smsAvailable: boolean
  phoneVerified: boolean
  phone: string
  gender: string | null
  whatsappInit: string
  headlineInit: string
  bioInit: string
  emailConfirmed: boolean
  busy: boolean
  onGender: (g: 'male' | 'female') => void
  onMobileVerified: () => void
  onContinue: (v: { whatsapp: string; headline: string; bio: string }) => void
}) {
  const [whatsapp, setWhatsapp] = useState(whatsappInit)
  const [tagline, setTagline] = useState(headlineInit)
  const [bio, setBio] = useState(bioInit)
  const [emailChoice, setEmailChoice] = useState<'add' | 'none'>(emailConfirmed ? 'add' : 'add')

  // Self-explaining checklist (PR80). Required: verified mobile, gender, tagline,
  // bio — mirrors stepDone('contact'). WhatsApp and email are optional.
  const items: ChecklistItem[] = [
    { en: 'Verify your mobile number', ur: 'اپنے موبائل نمبر کی تصدیق کریں', done: phoneVerified },
    { en: 'Add your WhatsApp number', ur: 'اپنا واٹس ایپ نمبر شامل کریں', done: !!whatsapp.trim(), optional: true },
    { en: 'Add your email', ur: 'اپنی ای میل شامل کریں', done: emailConfirmed, optional: true },
    { en: 'Choose your gender', ur: 'اپنی جنس منتخب کریں', done: !!gender },
    { en: 'Write a tagline', ur: 'ایک عنوان لکھیں', done: !!tagline.trim() },
    { en: 'Write a short about-you', ur: 'اپنے بارے میں مختصر لکھیں', done: !!bio.trim() },
  ]
  const ready = checklistReady(items)

  const fieldCls =
    'min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy'

  return (
    <div className="space-y-5">
      <FormChecklist items={items} />
      {/* Mobile — verified/read-only, or verify by SMS. */}
      <section className="space-y-2">
        <FieldLabel en="Mobile number" ur="موبائل نمبر" />
        {phoneVerified ? (
          <p className="flex items-center gap-2 rounded-xl bg-tm-tint-green px-3 py-2 text-xs font-bold text-tm-green-deep">
            <CheckCircle2 size={15} aria-hidden /> {phone || 'Your number'} — verified
          </p>
        ) : (
          <MobileStep support={support} initialPhone={phone} smsAvailable={smsAvailable} onVerified={onMobileVerified} />
        )}
      </section>

      {/* WhatsApp — optional, no verification, one-tap "Same as my mobile". */}
      <section className="space-y-2">
        <FieldLabel en="WhatsApp number (optional)" ur="واٹس ایپ نمبر (اختیاری)" />
        <input value={whatsapp} inputMode="tel" onChange={(e) => setWhatsapp(e.target.value)} placeholder="0300 1234567" aria-label="WhatsApp number" className={fieldCls} />
        <button type="button" onClick={() => setWhatsapp(phone)} disabled={!phone}
          className="text-[11px] font-bold text-tm-navy hover:underline disabled:opacity-40">
          Same as my mobile <span lang="ur" dir="rtl">— میرے موبائل جیسا</span>
        </button>
      </section>

      {/* Email — optional; EmailCard sends a confirm link. "I don't use email". */}
      <section className="space-y-2">
        <FieldLabel en="Email (optional)" ur="ای میل (اختیاری)" />
        {emailChoice === 'none' ? (
          <p className="text-[11px] text-gray-500">
            No email for now.{' '}
            <button type="button" className="font-bold text-tm-navy underline" onClick={() => setEmailChoice('add')}>Add an email</button>
          </p>
        ) : (
          <>
            <EmailCard />
            <button type="button" onClick={() => setEmailChoice('none')} className="text-[11px] font-bold text-gray-500 hover:underline">
              I don&rsquo;t use email <span lang="ur" dir="rtl">— میں ای میل استعمال نہیں کرتا</span>
            </button>
          </>
        )}
      </section>

      {/* Gender. */}
      <section className="space-y-2">
        <FieldLabel en="You are" ur="آپ ہیں" />
        <div className="grid grid-cols-2 gap-3">
          {(['male', 'female'] as const).map((g) => (
            <button key={g} type="button" onClick={() => onGender(g)} aria-pressed={gender === g}
              className={`flex min-h-[56px] items-center justify-center rounded-2xl border-2 text-sm font-black capitalize ${
                gender === g ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy'
              }`}>
              {g}
            </button>
          ))}
        </div>
      </section>

      {/* Tagline (prefilled from the tutor's own answers, editable). */}
      <section className="space-y-2">
        <FieldLabel en="Your tagline" ur="آپ کا عنوان" />
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. O Level Physics specialist" aria-label="Tagline" className={fieldCls} />
      </section>

      {/* Bio (prefilled, editable). */}
      <section className="space-y-2">
        <FieldLabel en="A short about-you" ur="اپنے بارے میں مختصر" />
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Two or three lines about how you teach" aria-label="About you"
          className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy" />
      </section>

      <div className="space-y-1">
        <button type="button" disabled={busy || !ready}
          onClick={() => onContinue({ whatsapp: whatsapp.trim(), headline: tagline.trim(), bio: bio.trim() })}
          className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40">
          {busy ? '…' : 'Continue'}
        </button>
        <ChecklistStatus items={items} />
      </div>
    </div>
  )
}

function FinalScreen({
  facts,
  onLeave,
}: {
  facts: FlowFacts
  onLeave: (to: string) => void
}) {
  const listed = isListed(facts)
  const blockers = directoryBlockers(toListingFacts(facts))
  const fixes = listingFixItems(blockers)
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
            {fixes.map((f) =>
              f.status || !f.href ? (
                <li
                  key={f.key}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-500"
                >
                  <Clock aria-hidden size={14} className="shrink-0" />
                  {f.label}
                </li>
              ) : (
                <li key={f.key}>
                  <Link href={f.href} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy">
                    {f.label}
                    <span aria-hidden className="text-tm-red">›</span>
                  </Link>
                </li>
              ),
            )}
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
