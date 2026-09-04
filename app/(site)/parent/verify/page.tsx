'use client'

import Breadcrumbs from '@/components/Breadcrumbs'
import { UPLOAD_TIMEOUT_MS, submitError, submitJson, submitSignal } from '@/lib/submit'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import FileUpload from '@/components/FileUpload'
import { calculateParentCompletion } from '@/lib/profileChecklist'

// Parent verification: CNIC number + image, address, mobile OTP.
//
// Submitting sets profiles.verification_state = 'submitted' for the T3.5 admin
// queue. Approval (cnic_verified_at + address_verified_at) is an admin action,
// and until it lands the parent cannot post a job -- shown plainly here rather
// than only discovered at the point of posting.

type Doc = { id: string; kind: 'cnic' | 'degree'; label: string | null }

export default function ParentVerifyPage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [fullName, setFullName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [cnic, setCnic] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpMsg, setOtpMsg] = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const [state, setState] = useState<'none' | 'submitted' | 'approved' | 'rejected'>('none')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login?next=/parent/verify'); return }

    const [{ data: p }, { data: dl }] = await Promise.all([
      supabase.from('profiles')
        .select('full_name, city, address, cnic_number, cnic_image_path, phone_number, phone_verified_at, verification_state, verification_rejection_reason')
        .eq('id', user.id).maybeSingle(),
      supabase.from('user_documents').select('id, kind, label').eq('user_id', user.id).eq('kind', 'cnic'),
    ])

    setFullName(p?.full_name ?? '')
    setCity(p?.city ?? '')
    setAddress(p?.address ?? '')
    setCnic(p?.cnic_number ?? '')
    setPhone(p?.phone_number ?? '')
    setPhoneVerified(Boolean(p?.phone_verified_at))
    setState((p?.verification_state as typeof state) ?? 'none')
    setRejectionReason(p?.verification_rejection_reason ?? null)
    setDocs((dl ?? []) as Doc[])
    setLoading(false)
  }, [router, supabase])

  useEffect(() => { load() }, [load])

  const completion = calculateParentCompletion({
    profile: {
      full_name: fullName, city, address, cnic_number: cnic,
      cnic_image_path: docs.length > 0 ? 'set' : null,
      phone_verified_at: phoneVerified ? 'set' : null,
    },
  })

  async function saveDetails() {
    setSaving(true); setErr(''); setMsg('')
    // submitJson, not a bare fetch: `await res.json()` threw on a dead
    // network and the setSaving(false) after it never ran, so Save sat on
    // "Saving…" and the verification could not be submitted at all.
    const { ok, error: failed } = await submitJson('/api/profile/save', {
      profile: { full_name: fullName, city, address, cnic_number: cnic },
    })
    setSaving(false)
    if (!ok) { setErr(failed ?? 'Could not save.'); return false }
    setMsg('Saved.'); return true
  }

  async function uploadCnic(file: File) {
    setSaving(true); setErr('')
    const fd = new FormData(); fd.append('kind', 'cnic'); fd.append('file', file)
    // An upload is the one submit here that cannot use submitJson (FormData,
    // and a slow connection legitimately needs longer than ten seconds), so it
    // gets the guarantee the other way round: a try/finally.
    let json: { documentId?: string; error?: string } = {}
    let ok = false
    try {
      const res = await fetch('/api/documents/upload', { signal: submitSignal(UPLOAD_TIMEOUT_MS), method: 'POST', body: fd })
      json = await res.json().catch(() => ({}))
      ok = res.ok
    } catch (e) {
      json = { error: submitError(e, 'Upload failed.') }
    } finally {
      setSaving(false)
    }
    if (!ok) { setErr(json.error ?? 'Upload failed.'); return }
    setDocs((d) => [{ id: json.documentId ?? '', kind: 'cnic', label: 'CNIC' }, ...d])
    setMsg('CNIC uploaded.')
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
    setPhoneVerified(true); setOtpMsg('Mobile number verified.'); await load()
  }

  async function submitForReview() {
    if (!(await saveDetails())) return
    setSaving(true); setErr('')
    const { ok, error: failed } = await submitJson('/api/parent/verify', {})
    setSaving(false)
    if (!ok) { setErr(failed ?? 'Could not submit.'); return }
    setState('submitted'); setMsg('Submitted for review.')
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">Loading…</div>
  }

  return (
    <main className="min-h-screen bg-tm-bg py-6 px-4 sm:px-6 text-slate-700">
      <div className="max-w-2xl mx-auto space-y-5">
        <Breadcrumbs items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'Verify your account' }]} />
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-black text-tm-navy">Verify your account</h1>
          <p className="text-xs text-gray-500">
            We verify every parent before they can post a job. It keeps tutors safe and gets you better responses.
          </p>
        </header>

        {state === 'approved' && (
          <div className="p-4 bg-tm-tint-green border border-tm-green-deep/30 rounded-2xl">
            <p className="text-xs font-black text-tm-green-deep">✓ Verified — you can post jobs</p>
          </div>
        )}
        {state === 'submitted' && (
          <div className="p-4 bg-tm-tint-gold border border-tm-gold/30 rounded-2xl space-y-1">
            <p className="text-xs font-black text-tm-gold-ink">Awaiting review</p>
            <p className="text-[11px] text-tm-gold-ink">
              Our team is checking your details, usually within a few hours.
              <strong> You cannot post a job until this is approved.</strong>
            </p>
          </div>
        )}
        {state === 'rejected' && (
          <div className="p-4 bg-tm-tint-red border border-tm-red/30 rounded-2xl space-y-1">
            <p className="text-xs font-black text-tm-red">We could not verify these details</p>
            {rejectionReason && <p className="text-[11px] text-tm-red">{rejectionReason}</p>}
            <p className="text-[11px] text-tm-red">Please correct them below and submit again.</p>
          </div>
        )}
        {state === 'none' && (
          <div className="p-4 bg-tm-black text-white rounded-2xl space-y-1">
            <p className="text-xs font-black">Not verified yet</p>
            <p className="text-[11px] text-gray-200">You cannot post a job until your CNIC and address are approved.</p>
          </div>
        )}

        {err && <div className="p-3 bg-tm-tint-red border border-tm-red/30 text-tm-red text-xs font-bold rounded-xl">{err}</div>}
        {msg && !err && <div className="p-3 bg-tm-tint-green border border-tm-green-deep/30 text-tm-green-deep text-xs font-bold rounded-xl">{msg}</div>}

        <section className="bg-white border border-gray-200 rounded-3xl p-4 sm:p-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-tm-navy">Your details</h2>
            <span className="text-xs font-black text-tm-navy">{completion.percent}%</span>
          </div>

          <F id="full_name" label="Full name" value={fullName} onChange={setFullName} />
          <F id="city" label="City" value={city} onChange={setCity} />
          <div className="space-y-1" id="address">
            <label htmlFor="address-input" className="text-xs font-bold text-tm-navy">Home address</label>
            <textarea id="address-input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
          </div>
          {/* ONE CARD, ONE TASK. The number and the photograph of the card it
              is printed on were two separate blocks with two headings, which
              reads as two unrelated chores — and a parent who filled in the
              number and stopped had no signal that the job was half done.
              They are one heading now, and the card is either complete or it
              is not. */}
          <fieldset
            id="cnic"
            className="space-y-3 rounded-2xl border border-gray-200 bg-tm-bg p-4"
          >
            <legend className="px-1 text-xs font-black text-tm-navy">Your CNIC</legend>
            <p className="text-[11px] leading-relaxed text-gray-500">
              The number and a photo of the card. Both are needed before you can post a
              tuition, and only you and our verification team can see them.
            </p>

            <div className="space-y-1" id="cnic_number">
              <label htmlFor="cnic_number-input" className="text-xs font-bold text-tm-navy">
                CNIC number
              </label>
              <input
                id="cnic_number-input"
                value={cnic}
                placeholder="35202-1234567-8"
                inputMode="numeric"
                onChange={(e) => setCnic(e.target.value)}
                className={inputCls}
              />
            </div>

            <div id="cnic_image">
              <FileUpload
                label="CNIC image"
                acceptLabel="JPG or PNG"
                hint="The front of the card, with all four corners in frame and the text readable."
                onFile={uploadCnic}
                currentPreview={
                  docs.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 pb-2">
                      {docs.map((d) => (
                        <SecureDocumentPreview key={d.id} documentId={d.id} alt="CNIC preview" />
                      ))}
                    </div>
                  ) : undefined
                }
              />
            </div>
          </fieldset>

          <div className="space-y-2 pt-1" id="phone">
            <label className="text-xs font-bold text-tm-navy">Mobile number</label>
            {phoneVerified ? (
              <p className="text-xs font-bold text-tm-green-deep bg-tm-tint-green border border-tm-green-deep/30 rounded-xl p-3">✓ Verified</p>
            ) : (
              <>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03214567890" className={inputCls} />
                <button onClick={sendOtp} disabled={cooldown > 0 || !phone} className={btnDark}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : otpSent ? 'Resend code' : 'Send code'}
                </button>
                {otpSent && (
                  <>
                    <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="000000" className={inputCls} />
                    <button onClick={verifyOtp} disabled={!otp} className={btnRed}>Verify</button>
                  </>
                )}
                {otpMsg && <p className="text-[11px] font-bold text-tm-green-deep">{otpMsg}</p>}
              </>
            )}
          </div>
        </section>

        {completion.missing.length > 0 && (
          <ul className="bg-white border border-gray-200 rounded-2xl p-4 space-y-1">
            <li className="text-xs font-bold text-tm-navy pb-1">Still needed</li>
            {completion.missing.map((m) => <li key={m.key} className="text-xs text-gray-600">• {m.label}</li>)}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={saveDetails} disabled={saving} className="flex-1 min-h-[44px] py-3 bg-tm-bg border border-gray-200 text-slate-700 font-bold text-xs rounded-xl disabled:opacity-50">
            Save for later
          </button>
          <button
            onClick={submitForReview}
            disabled={saving || completion.percent < 100 || state === 'submitted'}
            className="flex-[2] min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs uppercase tracking-wider rounded-xl disabled:opacity-50"
          >
            {state === 'submitted' ? 'Awaiting review' : 'Submit for verification'}
          </button>
        </div>


      </div>
    </main>
  )
}

const inputCls =
  'w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy focus:bg-white'
const btnDark =
  'w-full min-h-[44px] py-3 bg-tm-black hover:bg-tm-green-deep text-white font-bold text-xs uppercase tracking-wider rounded-xl disabled:opacity-40 transition-colors'
const btnRed =
  'w-full min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs uppercase tracking-wider rounded-xl disabled:opacity-40 transition-colors'

function F({ id, label, value, onChange, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="space-y-1" id={id}>
      <label htmlFor={`${id}-input`} className="text-xs font-bold text-tm-navy">{label}</label>
      <input id={`${id}-input`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  )
}
