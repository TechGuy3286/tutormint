'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, IdCard, Image as ImageIcon, MapPin, Smartphone, UserSquare2, BookOpen } from 'lucide-react'

import MobileNumberInput from '@/components/auth/MobileNumberInput'
import CnicCapture, { type CnicCaptureState } from '@/components/identity/CnicCapture'
import TaxonomySelector from '@/components/TaxonomySelector'
import LocationInput from '@/components/forms/LocationInput'
import { useToast } from '@/components/ui/Toast'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import { resolveMasterIds } from '@/lib/taxonomy'
import { compressUnder1MB } from '@/lib/imageCompress'

// PR83 (Part B) — staff edit of a tutor's locked step-1 fields, on
// /admin/tutors/[id]. Rendered only when the actor is admin/operations
// (SCREEN_ACCESS.tutorEdit); every save also re-checks the role in the route.
//
// A reason is required for every edit (it goes on the change-history row). Each
// section posts to a service-role admin route — writes bypass the PR72 member
// locks, which stay exactly as they are for members. CNIC / profile picture /
// selfie edits are saved as APPROVED by the acting staff member (in the route).
//
// The CNIC section reuses the SHARED CnicCapture (PR81), pointed at the admin
// media route with the target tutor + reason, so staff and members capture a
// CNIC through the same control.

const REASON_MIN = 3

function Section({
  icon,
  title,
  titleUr,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  title: string
  titleUr: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[52px] w-full items-center gap-2 px-4 text-left"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-tm-tint-navy text-tm-navy">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-black text-tm-navy">{title}</span>
          <span lang="ur" dir="rtl" className="tm-ur-cap block text-[11px] font-bold text-gray-500">
            {titleUr}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          size={16}
          className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="space-y-3 border-t border-gray-100 p-4">{children}</div>}
    </div>
  )
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-bold text-tm-navy">Reason for this change</span>
      <span lang="ur" dir="rtl" className="tm-ur-cap block text-[11px] text-gray-500">
        اس تبدیلی کی وجہ
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Why are you changing this?"
        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy"
      />
    </label>
  )
}

const SAVE_BTN =
  'inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50 sm:w-auto'

export default function TutorFieldEditor({
  tutorId,
  currentCity,
}: {
  tutorId: string
  currentCity: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const { map } = useCityAreas()
  const cities = map.cities
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k))

  // ---- shared JSON post to /api/admin/tutors/edit --------------------------
  const [busy, setBusy] = useState<string | null>(null)
  async function postEdit(action: string, payload: Record<string, unknown>, reason: string): Promise<boolean> {
    if (reason.trim().length < REASON_MIN) {
      toast.error('Please give a reason for this change.')
      return false
    }
    setBusy(action)
    try {
      const res = await fetch('/api/admin/tutors/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tutorId, reason: reason.trim(), ...payload }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? 'Could not save that.')
        return false
      }
      toast.success('Saved.')
      router.refresh()
      return true
    } finally {
      setBusy(null)
    }
  }

  // ---- mobile --------------------------------------------------------------
  const [mobile, setMobile] = useState('')
  const [mobileReason, setMobileReason] = useState('')

  // ---- cnic ----------------------------------------------------------------
  const [cnicReason, setCnicReason] = useState('')
  const [, setCap] = useState<CnicCaptureState | null>(null)

  // ---- subjects ------------------------------------------------------------
  const [level, setLevel] = useState('')
  const [grades, setGrades] = useState<string[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [subjectsReason, setSubjectsReason] = useState('')

  // ---- city ----------------------------------------------------------------
  const [city, setCity] = useState(currentCity ?? '')
  const [cityReason, setCityReason] = useState('')

  // ---- areas ---------------------------------------------------------------
  const [areaDraft, setAreaDraft] = useState('')
  const [areaList, setAreaList] = useState<string[]>([])
  const [areasReason, setAreasReason] = useState('')
  const cityAreaOptions = areasForCity(map, city || currentCity || '')

  // ---- image upload (profile picture / selfie) -----------------------------
  const [imgReason, setImgReason] = useState<Record<'avatar' | 'selfie', string>>({ avatar: '', selfie: '' })
  async function uploadImage(kind: 'avatar' | 'selfie', file: File) {
    const reason = imgReason[kind]
    if (reason.trim().length < REASON_MIN) {
      toast.error('Please give a reason for this change.')
      return
    }
    setBusy(kind)
    try {
      const img = await compressUnder1MB(file)
      const fd = new FormData()
      fd.append('tutorId', tutorId)
      fd.append('kind', kind)
      fd.append('reason', reason.trim())
      fd.append('file', img)
      const res = await fetch('/api/admin/tutors/media', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? 'Could not upload that.')
        return
      }
      toast.success('Saved and approved.')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-tm-navy/20 bg-tm-tint-navy/30 p-3">
      <div className="px-1">
        <h2 className="text-xs font-black text-tm-navy">Edit this tutor&rsquo;s details</h2>
        <p className="text-[11px] text-gray-500">
          Staff-only. Every change needs a reason and is kept in the history below.
        </p>
      </div>

      {/* Mobile */}
      <Section icon={<Smartphone size={16} />} title="Mobile number" titleUr="موبائل نمبر" open={open === 'mobile'} onToggle={() => toggle('mobile')}>
        <label className="block space-y-1">
          <span className="block text-[11px] font-bold text-tm-navy">New mobile number</span>
          <MobileNumberInput value={mobile} onChange={setMobile} />
        </label>
        <ReasonField value={mobileReason} onChange={setMobileReason} />
        <button
          type="button"
          disabled={busy === 'set-mobile' || !mobile}
          onClick={async () => { if (await postEdit('set-mobile', { mobile }, mobileReason)) { setMobile(''); setMobileReason('') } }}
          className={SAVE_BTN}
        >
          {busy === 'set-mobile' ? 'Saving…' : 'Save mobile (verified)'}
        </button>
      </Section>

      {/* CNIC — shared CnicCapture pointed at the admin media route */}
      <Section icon={<IdCard size={16} />} title="CNIC (number and pictures)" titleUr="شناختی کارڈ" open={open === 'cnic'} onToggle={() => toggle('cnic')}>
        <ReasonField value={cnicReason} onChange={setCnicReason} />
        <p className="text-[11px] text-gray-500">
          Enter the reason first. Saving a CNIC here marks it approved by you.
        </p>
        <CnicCapture
          onState={setCap}
          uploadUrl="/api/admin/tutors/media"
          uploadExtra={{ tutorId, reason: cnicReason.trim() }}
          saveNumber={async (n) => {
            if (cnicReason.trim().length < REASON_MIN) return { ok: false, error: 'Please give a reason for this change.' }
            const res = await fetch('/api/admin/tutors/edit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'set-cnic-number', tutorId, reason: cnicReason.trim(), cnicNumber: n }),
            })
            if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error ?? 'Could not save the CNIC number.' }
            router.refresh()
            return { ok: true }
          }}
        />
      </Section>

      {/* Profile picture */}
      <Section icon={<ImageIcon size={16} />} title="Profile picture" titleUr="پروفائل تصویر" open={open === 'avatar'} onToggle={() => toggle('avatar')}>
        <ReasonField value={imgReason.avatar} onChange={(v) => setImgReason((r) => ({ ...r, avatar: v }))} />
        <label className={SAVE_BTN + ' cursor-pointer'}>
          {busy === 'avatar' ? 'Uploading…' : 'Choose a photo'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy === 'avatar'}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage('avatar', f); e.target.value = '' }}
          />
        </label>
      </Section>

      {/* Selfie */}
      <Section icon={<UserSquare2 size={16} />} title="Selfie" titleUr="سیلفی" open={open === 'selfie'} onToggle={() => toggle('selfie')}>
        <ReasonField value={imgReason.selfie} onChange={(v) => setImgReason((r) => ({ ...r, selfie: v }))} />
        <label className={SAVE_BTN + ' cursor-pointer'}>
          {busy === 'selfie' ? 'Uploading…' : 'Choose a photo'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy === 'selfie'}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage('selfie', f); e.target.value = '' }}
          />
        </label>
      </Section>

      {/* Subjects */}
      <Section icon={<BookOpen size={16} />} title="Subjects" titleUr="مضامین" open={open === 'subjects'} onToggle={() => toggle('subjects')}>
        <TaxonomySelector
          selectedLevel={level}
          setSelectedLevel={setLevel}
          selectedGrades={grades}
          setSelectedGrades={setGrades}
          selectedSubjects={subjects}
          setSelectedSubjects={setSubjects}
          allowSelectAll={false}
        />
        <ReasonField value={subjectsReason} onChange={setSubjectsReason} />
        <button
          type="button"
          disabled={busy === 'set-subjects' || subjects.length === 0}
          onClick={async () => {
            const ids = await resolveMasterIds(level, grades, subjects)
            if (ids.length === 0) { toast.error('Choose at least one subject.'); return }
            if (await postEdit('set-subjects', { subjectMasterIds: ids }, subjectsReason)) {
              setLevel(''); setGrades([]); setSubjects([]); setSubjectsReason('')
            }
          }}
          className={SAVE_BTN}
        >
          {busy === 'set-subjects' ? 'Saving…' : 'Replace subjects'}
        </button>
      </Section>

      {/* City */}
      <Section icon={<MapPin size={16} />} title="City" titleUr="شہر" open={open === 'city'} onToggle={() => toggle('city')}>
        <LocationInput id="edit-city" label="City" value={city} onChange={setCity} options={cities} icon={<MapPin size={15} />} />
        <ReasonField value={cityReason} onChange={setCityReason} />
        <button
          type="button"
          disabled={busy === 'set-city' || !city.trim()}
          onClick={async () => { if (await postEdit('set-city', { city: city.trim() }, cityReason)) setCityReason('') }}
          className={SAVE_BTN}
        >
          {busy === 'set-city' ? 'Saving…' : 'Save city'}
        </button>
      </Section>

      {/* Areas */}
      <Section icon={<MapPin size={16} />} title="Areas" titleUr="علاقے" open={open === 'areas'} onToggle={() => toggle('areas')}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <LocationInput id="edit-area" label="Add an area" value={areaDraft} onChange={setAreaDraft} options={cityAreaOptions} placeholder="Add an area" icon={<MapPin size={15} />} />
          </div>
          <button
            type="button"
            onClick={() => { const a = areaDraft.trim(); if (a && !areaList.includes(a)) setAreaList((l) => [...l, a]); setAreaDraft('') }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
          >
            Add
          </button>
        </div>
        {areaList.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {areaList.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAreaList((l) => l.filter((x) => x !== a))}
                className="inline-flex items-center gap-1 rounded-full bg-tm-red px-2.5 py-1 text-[11px] font-bold text-white"
              >
                {a} <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
        <ReasonField value={areasReason} onChange={setAreasReason} />
        <button
          type="button"
          disabled={busy === 'set-areas' || areaList.length === 0}
          onClick={async () => { if (await postEdit('set-areas', { areas: areaList }, areasReason)) { setAreaList([]); setAreasReason('') } }}
          className={SAVE_BTN}
        >
          {busy === 'set-areas' ? 'Saving…' : 'Replace areas'}
        </button>
      </Section>
    </section>
  )
}
