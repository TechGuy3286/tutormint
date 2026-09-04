'use client'

import { ShieldCheck } from 'lucide-react'

import FileUpload from '@/components/FileUpload'

import Breadcrumbs from '@/components/Breadcrumbs'
import { UPLOAD_TIMEOUT_MS, submitJson, submitSignal } from '@/lib/submit'
import Avatar from '@/components/Avatar'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TaxonomySelector from '@/components/TaxonomySelector'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import { resolveMasterIds, isLevelLeaf, labelsForMasterIds } from '@/lib/taxonomy'
import { calculateTutorCompletion } from '@/lib/profileChecklist'
import { TEACHING_MODES } from '@/lib/locations'
import { teachingMode } from '@/lib/display'

// Mobile-first, resumable, saves per step. Every step writes through
// /api/profile/save (or a dedicated upload route), which recomputes
// profiles.profile_completion server-side -- the client never decides the
// percentage.
//
// Base classes target 360px; sm:/md: widen from there. Tap targets are >=44px.

const STEPS = [
  'Basics',
  'Photo & tagline',
  'Subjects',
  'Experience & fee',
  'Documents',
  'Mobile',
  'Video',
] as const

type Doc = { id: string; kind: 'cnic' | 'degree'; label: string | null }

function CompleteProfileInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [percent, setPercent] = useState(0)

  const [userId, setUserId] = useState('')
  const [form, setForm] = useState({
    full_name: '', gender: '', city: '', area: '',
    avatar_url: '', headline: '', bio: '',
    experience_years: '', hourly_rate_pkr: '', teaching_mode: '',
    cnic_number: '', degreesText: '',
  })

  // Subjects
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [subjects, setSubjects] = useState<string[]>([])
  const [savedSubjectLabels, setSavedSubjectLabels] = useState<string[]>([])
  const [levelLeaf, setLevelLeaf] = useState(false)

  const [docs, setDocs] = useState<Doc[]>([])

  // OTP
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpMsg, setOtpMsg] = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // Video
  const [videoAttempts, setVideoAttempts] = useState(0)
  const [videoStatus, setVideoStatus] = useState('none')
  const [videoMsg, setVideoMsg] = useState('')

  useEffect(() => {
    const s = Number(searchParams.get('step'))
    if (s >= 1 && s <= STEPS.length) setStep(s)
  }, [searchParams])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login?next=/tutor/complete-profile'); return }
    setUserId(user.id)

    const [{ data: p }, { data: tp }, { data: ts }, { data: dl }] = await Promise.all([
      supabase.from('profiles').select('full_name, city, cnic_number, cnic_image_path, phone_number, phone_verified_at, profile_completion').eq('id', user.id).maybeSingle(),
      supabase.from('tutor_profiles').select('gender, area, avatar_url, headline, bio, experience_years, hourly_rate_pkr, teaching_mode, degrees, video_youtube_id, video_status, video_attempts').eq('id', user.id).maybeSingle(),
      supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
      supabase.from('user_documents').select('id, kind, label').eq('user_id', user.id).order('created_at', { ascending: false }),
    ])

    setForm({
      full_name: p?.full_name ?? '',
      gender: tp?.gender ?? '',
      city: p?.city ?? '',
      area: tp?.area ?? '',
      avatar_url: tp?.avatar_url ?? '',
      headline: tp?.headline ?? '',
      bio: tp?.bio ?? '',
      experience_years: tp?.experience_years != null ? String(tp.experience_years) : '',
      hourly_rate_pkr: tp?.hourly_rate_pkr != null ? String(tp.hourly_rate_pkr) : '',
      teaching_mode: tp?.teaching_mode ?? '',
      cnic_number: p?.cnic_number ?? '',
      degreesText: (tp?.degrees ?? []).join('\n'),
    })
    setPhone(p?.phone_number ?? '')
    setPhoneVerified(Boolean(p?.phone_verified_at))
    setPercent(p?.profile_completion ?? 0)
    setDocs((dl ?? []) as Doc[])
    setVideoAttempts(tp?.video_attempts ?? 0)
    setVideoStatus(tp?.video_status ?? 'none')

    const ids = (ts ?? []).map((r) => r.master_id as number)
    if (ids.length) setSavedSubjectLabels(await labelsForMasterIds(ids))

    setLoading(false)
  }, [router, supabase])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!category || !level) { setLevelLeaf(false); return }
    isLevelLeaf(category, level).then(setLevelLeaf)
  }, [category, level])

  // Live preview of the percentage while typing; the server value wins on save.
  const localCompletion = useMemo(
    () =>
      calculateTutorCompletion({
        profile: {
          full_name: form.full_name, city: form.city, cnic_number: form.cnic_number,
          cnic_image_path: docs.some((d) => d.kind === 'cnic') ? 'set' : null,
          phone_verified_at: phoneVerified ? 'set' : null,
        },
        tutorProfile: {
          gender: form.gender, area: form.area, avatar_url: form.avatar_url,
          headline: form.headline, bio: form.bio,
          experience_years: Number(form.experience_years) || null,
          hourly_rate_pkr: Number(form.hourly_rate_pkr) || null,
          teaching_mode: form.teaching_mode,
          degrees: form.degreesText.split('\n').map((s) => s.trim()).filter(Boolean),
          video_status: videoStatus,
        },
        subjectCount: savedSubjectLabels.length,
        degreeDocCount: docs.filter((d) => d.kind === 'degree').length,
      }),
    [form, docs, phoneVerified, savedSubjectLabels, videoStatus],
  )

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function saveStep(payload: Record<string, unknown>) {
    setSaving(true); setErr(''); setMsg('')
    const { ok, data, error: failed } = await submitJson<{ completion?: number }>(
      '/api/profile/save',
      payload,
    )
    setSaving(false)
    if (!ok) { setErr(failed ?? 'Could not save.'); return false }
    if (typeof data?.completion === 'number') setPercent(data.completion)
    setMsg('Saved.')
    return true
  }

  async function next() {
    let ok = true
    if (step === 1) ok = await saveStep({ profile: { full_name: form.full_name, city: form.city }, tutorProfile: { gender: form.gender, area: form.area } })
    if (step === 2) ok = await saveStep({ tutorProfile: { avatar_url: form.avatar_url, headline: form.headline, bio: form.bio } })
    if (step === 3) {
      const ids = await resolveMasterIds(category, level, levelLeaf ? [] : subjects)
      if (ids.length === 0) { setErr('Pick at least one subject (or a level such as IELTS Preparation).'); return }
      ok = await saveStep({ subjectMasterIds: ids })
      if (ok) setSavedSubjectLabels(await labelsForMasterIds(ids))
    }
    if (step === 4) ok = await saveStep({ tutorProfile: { experience_years: Number(form.experience_years) || null, hourly_rate_pkr: Number(form.hourly_rate_pkr) || null, teaching_mode: form.teaching_mode } })
    if (step === 5) ok = await saveStep({ profile: { cnic_number: form.cnic_number }, tutorProfile: { degrees: form.degreesText.split('\n').map((s) => s.trim()).filter(Boolean) } })
    if (ok && step < STEPS.length) setStep((s) => s + 1)
  }

  async function uploadDoc(kind: 'cnic' | 'degree', file: File, label?: string) {
    setSaving(true); setErr('')
    const fd = new FormData()
    fd.append('kind', kind); fd.append('file', file)
    if (label) fd.append('label', label)
    const res = await fetch('/api/documents/upload', { signal: submitSignal(UPLOAD_TIMEOUT_MS), method: 'POST', body: fd })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setErr(json.error ?? 'Upload failed.'); return }
    if (typeof json.completion === 'number') setPercent(json.completion)
    setDocs((d) => [{ id: json.documentId, kind, label: label ?? null }, ...d])
    setMsg('Uploaded.')
  }

  async function uploadAvatar(file: File) {
    setSaving(true); setErr('')
    const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (error) { setErr(error.message); setSaving(false); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    set('avatar_url', data.publicUrl)
    await saveStep({ tutorProfile: { avatar_url: data.publicUrl } })
  }

  async function sendOtp() {
    setOtpMsg(''); setErr('')
    const res = await fetch('/api/auth/otp', { signal: submitSignal(), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', phone }) })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? 'Could not send code.'); if (json.retryAfterSeconds) setCooldown(json.retryAfterSeconds); return }
    setOtpSent(true); setCooldown(60)
    setOtpMsg(json.devBypassActive ? 'Development mode: use the DEV_DEFAULT_OTP code.' : 'Code sent.')
  }

  async function verifyOtp() {
    setOtpMsg(''); setErr('')
    const res = await fetch('/api/auth/otp', { signal: submitSignal(), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', phone, code: otp }) })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? 'Could not verify.'); return }
    setPhoneVerified(true); setOtpMsg('Mobile number verified.')
    await load()
  }

  async function uploadVideo(file: File) {
    setVideoMsg(''); setErr(''); setSaving(true)
    const fd = new FormData()
    fd.append('video', file); fd.append('title', `TutorMint intro — ${form.full_name}`)
    const res = await fetch('/tutor/upload-youtube', { signal: submitSignal(UPLOAD_TIMEOUT_MS), method: 'POST', body: fd })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setVideoMsg(
        json.unavailable
          ? `Video upload is temporarily unavailable. The server is missing: ${(json.missingEnv ?? []).join(', ')}. Your submission was NOT recorded — please try again later.`
          : (json.error ?? 'Upload failed.'),
      )
      return
    }
    setVideoStatus('uploaded'); setVideoAttempts(json.attempt)
    if (typeof json.completion === 'number') setPercent(json.completion)
    setVideoMsg(`Video submitted. ${json.attemptsLeft} submission(s) left.`)
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">Loading…</div>
  }

  const shown = percent || localCompletion.percent

  return (
    <main className="min-h-screen bg-tm-bg pb-28 sm:pb-10 text-slate-700">
      <div className="mx-auto max-w-2xl px-4 pt-4 sm:px-6">
        <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Complete your profile' }]} />
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <header className="space-y-3">
          <h1 className="text-xl sm:text-2xl font-black text-tm-navy">Complete your profile</h1>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={shown} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-tm-green-deep rounded-full transition-all" style={{ width: `${shown}%` }} />
            </div>
            <span className="text-sm font-black text-tm-navy shrink-0">{shown}%</span>
          </div>
          <p className="text-[11px] text-gray-500">You need 100% to appear in the tutor directory.</p>
        </header>

        {/* Step rail: scrolls horizontally on narrow screens */}
        <nav className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Steps">
          {STEPS.map((label, i) => (
            <button
              key={label}
              onClick={() => setStep(i + 1)}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={`min-h-[44px] whitespace-nowrap px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                step === i + 1 ? 'bg-tm-black text-white border-tm-navy' : 'bg-white text-slate-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </nav>

        {err && <div className="p-3 bg-tm-tint-red border border-tm-red/30 text-tm-red text-xs font-bold rounded-xl">{err}</div>}
        {msg && !err && <div className="p-3 bg-tm-tint-green border border-tm-green-deep/30 text-tm-green-deep text-xs font-bold rounded-xl">{msg}</div>}

        <section className="bg-white border border-gray-200 rounded-3xl p-4 sm:p-6 space-y-4">
          {step === 1 && (
            <>
              <Field id="full_name" label="Full name" value={form.full_name} onChange={(v) => set('full_name', v)} />
              <div className="space-y-1" id="gender">
                <label htmlFor="gender-select" className="text-xs font-bold text-tm-navy">Gender</label>
                <select id="gender-select" value={form.gender} onChange={(e) => set('gender', e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Prefer not to say</option>
                </select>
              </div>
              <Field id="city" label="City" value={form.city} onChange={(v) => set('city', v)} />
              <Field id="area" label="Area" value={form.area} onChange={(v) => set('area', v)} placeholder="DHA Phase 5" />
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2" id="avatar">
                <label className="text-xs font-bold text-tm-navy">Profile photo</label>
                <Avatar
                  name={form.full_name}
                  src={form.avatar_url || null}
                  decorative
                  ring="border border-gray-200"
                  className="h-20 w-20 text-lg"
                />
                <FileUpload label="Profile photo" acceptLabel="JPG or PNG" onFile={uploadAvatar} />
                <p className="text-[11px] text-gray-500">By uploading you agree TutorMint may use this photo in promotional material.</p>
              </div>
              <Field id="headline" label="Professional tagline" value={form.headline} onChange={(v) => set('headline', v)} placeholder="O/A Level Physics specialist" />
              <div className="space-y-1" id="bio">
                <label htmlFor="bio-input" className="text-xs font-bold text-tm-navy">About you</label>
                <textarea id="bio-input" rows={4} value={form.bio} onChange={(e) => set('bio', e.target.value)} className={inputCls} />
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3" id="subjects">
              {savedSubjectLabels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {savedSubjectLabels.map((s) => (
                    <span key={s} className="px-2.5 py-1 bg-tm-tint-green text-tm-green-deep text-[11px] font-bold rounded-lg border border-tm-green-deep/30">{s}</span>
                  ))}
                </div>
              )}
              <TaxonomySelector
                selectedLevel={category} setSelectedLevel={setCategory}
                selectedGrade={level} setSelectedGrade={setLevel}
                selectedSubjects={subjects} setSelectedSubjects={setSubjects}
              />
              {levelLeaf && (
                <p className="text-[11px] font-bold text-tm-green-deep bg-tm-tint-green border border-tm-green-deep/30 rounded-xl p-2.5">
                  “{level}” is selectable on its own — no subject needed. Press Save &amp; continue.
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <>
              <Field id="experience_years" label="Years of experience" type="number" value={form.experience_years} onChange={(v) => set('experience_years', v)} />
              <Field id="hourly_rate_pkr" label="Expected monthly fee (PKR)" type="number" value={form.hourly_rate_pkr} onChange={(v) => set('hourly_rate_pkr', v)} />
              <div className="space-y-1" id="teaching_mode">
                <label htmlFor="mode-select" className="text-xs font-bold text-tm-navy">Teaching mode</label>
                <select id="mode-select" value={form.teaching_mode} onChange={(e) => set('teaching_mode', e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  {/* Canonical values, labelled through lib/display so the
                      words here cannot drift from the words on a card. */}
                  {TEACHING_MODES.map((m) => (
                    <option key={m} value={m}>{teachingMode(m)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <div className="space-y-1" id="degrees">
                <label htmlFor="degrees-input" className="text-xs font-bold text-tm-navy">Your degrees (one per line)</label>
                <textarea id="degrees-input" rows={3} value={form.degreesText} onChange={(e) => set('degreesText', e.target.value)} placeholder="BS Physics — Punjab University (2019)" className={inputCls} />
                <label className="block text-xs font-bold text-tm-navy pt-2">Certificate image</label>
                <FileUpload label="Degree certificate" acceptLabel="JPG or PNG" onFile={(f) => uploadDoc('degree', f, 'Degree certificate')} />
                <DocList docs={docs.filter((d) => d.kind === 'degree')} alt="Degree certificate preview" />
              </div>
              <hr className="border-gray-100" />
              <div className="space-y-1" id="cnic">
                <Field id="cnic_number" label="CNIC number" value={form.cnic_number} onChange={(v) => set('cnic_number', v)} placeholder="35202-1234567-8" />
                <label className="block text-xs font-bold text-tm-navy pt-2">CNIC image</label>
                <FileUpload label="CNIC image" acceptLabel="JPG or PNG" onFile={(f) => uploadDoc('cnic', f, 'CNIC')} />
                <DocList docs={docs.filter((d) => d.kind === 'cnic')} alt="CNIC preview" />
                <p className="text-[11px] text-gray-500">Only you and our verification team can see this. Previews are watermarked and protected against casual copying.</p>
              </div>
            </>
          )}

          {step === 6 && (
            <div className="space-y-3" id="phone">
              {phoneVerified ? (
                <p className="text-xs font-bold text-tm-green-deep bg-tm-tint-green border border-tm-green-deep/30 rounded-xl p-3">✓ Mobile number verified</p>
              ) : (
                <>
                  <Field id="phone_number" label="Mobile number" value={phone} onChange={setPhone} placeholder="03214567890" />
                  <button onClick={sendOtp} disabled={cooldown > 0 || !phone} className={btnDark}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : otpSent ? 'Resend code' : 'Send code'}
                  </button>
                  {otpSent && (
                    <>
                      <Field id="otp" label="6-digit code" value={otp} onChange={setOtp} placeholder="000000" />
                      <button onClick={verifyOtp} disabled={!otp} className={btnRed}>
                        <ShieldCheck aria-hidden size={13} />
                        Verify
                      </button>
                    </>
                  )}
                  {otpMsg && <p className="text-[11px] font-bold text-tm-green-deep">{otpMsg}</p>}
                </>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-3" id="video">
              <p className="text-xs text-gray-600 leading-relaxed">
                Record a short introduction. It is uploaded privately and reviewed by our team.
                You have <strong>{Math.max(0, 3 - videoAttempts)}</strong> of 3 submissions left.
              </p>
              {videoStatus !== 'none' && (
                <p className="text-xs font-bold text-tm-green-deep bg-tm-tint-green border border-tm-green-deep/30 rounded-xl p-3">
                  Video submitted — status: {videoStatus}
                </p>
              )}
              {videoAttempts >= 3 ? (
                <p className="text-xs font-bold text-tm-red bg-tm-tint-red border border-tm-red/30 rounded-xl p-3">
                  You have used all 3 submissions. Please contact support@tutormint.org.
                </p>
              ) : (
                <FileUpload
                  label="Introduction video"
                  accept="video/*"
                  acceptLabel="MP4 or MOV"
                  maxBytes={200 * 1024 * 1024}
                  onFile={uploadVideo}
                />
              )}
              {videoMsg && <p className="text-[11px] font-bold text-slate-700 bg-tm-bg border border-gray-200 rounded-xl p-3">{videoMsg}</p>}
              {shown >= 100 && (
                <button onClick={() => router.push('/tutor/dashboard')} className={btnRed}>Done — go to dashboard</button>
              )}
            </div>
          )}
        </section>

        {localCompletion.missing.length > 0 && (
          <details className="bg-white border border-gray-200 rounded-2xl p-4">
            <summary className="text-xs font-bold text-tm-navy cursor-pointer min-h-[44px] flex items-center">
              Still missing ({localCompletion.missing.length})
            </summary>
            <ul className="pt-2 space-y-1">
              {localCompletion.missing.map((m) => (
                <li key={m.key}>
                  <button onClick={() => setStep(m.step)} className="text-xs text-slate-700 hover:text-tm-red text-left min-h-[36px]">• {m.label}</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Sticky action bar on mobile */}
      <div className="fixed sm:static bottom-0 left-0 right-0 bg-white sm:bg-transparent border-t sm:border-0 border-gray-200 p-3 sm:p-0 flex gap-2 max-w-2xl mx-auto sm:px-6 sm:pb-8">
        <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1} className="flex-1 sm:flex-none min-h-[44px] px-5 py-3 bg-tm-bg border border-gray-200 text-slate-700 font-bold text-xs rounded-xl disabled:opacity-40">
          Back
        </button>
        {step < STEPS.length && (
          <button onClick={next} disabled={saving} className="flex-[2] sm:flex-none min-h-[44px] px-6 py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs rounded-xl disabled:opacity-50">
            {saving ? 'Saving…' : 'Save & continue'}
          </button>
        )}
      </div>
    </main>
  )
}

const inputCls =
  'w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy focus:bg-white'
const btnDark =
  'inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 py-3 bg-tm-black hover:bg-tm-green-deep text-white font-bold text-xs rounded-xl disabled:opacity-40 transition-colors'
const btnRed =
  'inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs rounded-xl disabled:opacity-40 transition-colors'

function Field({ id, label, value, onChange, type = 'text', placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div className="space-y-1" id={id}>
      <label htmlFor={`${id}-input`} className="text-xs font-bold text-tm-navy">{label}</label>
      <input id={`${id}-input`} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  )
}

function DocList({ docs, alt }: { docs: Doc[]; alt: string }) {
  if (docs.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2 pt-2">
      {docs.map((d) => (
        <SecureDocumentPreview key={d.id} documentId={d.id} alt={alt} />
      ))}
    </div>
  )
}

export default function CompleteProfilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">Loading…</div>}>
      <CompleteProfileInner />
    </Suspense>
  )
}
