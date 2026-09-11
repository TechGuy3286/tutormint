'use client'

import { submitSignal } from '@/lib/submit'

import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import Avatar from '@/components/Avatar'
import FileUpload from '@/components/FileUpload'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { looksLikeEmail } from '@/lib/phone'

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Everything a parent can change about themselves.
//
// There was no such screen. A parent could not add a picture, correct a
// mistyped number, or say which part of the city they are in — the only writes
// available to them were the verification flow, which is a one-way submission,
// and the children editor. Somebody who typed "Lahroe" at signup lived with it.

export type ParentSettings = {
  userId: string
  fullName: string
  avatarUrl: string | null
  phone: string
  phoneVerified: boolean
  /** The real address, or '' when the account only has a synthetic mobile one. */
  email: string
  city: string
  area: string
  address: string
}

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-tm-bg px-3 text-sm outline-none focus:border-tm-navy focus:bg-white'
const LABEL = 'text-xs font-bold text-tm-navy'

export default function SettingsClient({ initial }: { initial: ParentSettings }) {
  const router = useRouter()
  const supabase = createClient()
  const toast = useToast()

  // ---------------------------------------------------------------- email ---
  const [email, setEmail] = useState(initial.email)
  const [emailBusy, setEmailBusy] = useState(false)
  const emailChanged = email.trim().toLowerCase() !== initial.email.trim().toLowerCase()

  const saveEmail = async () => {
    setEmailBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account/email', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save that email.')
      toast.success(initial.email ? 'Email updated.' : 'Email added.')
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save that email.'
      setError(msg)
      toast.error(msg)
    } finally {
      setEmailBusy(false)
    }
  }

  const [fullName, setFullName] = useState(initial.fullName)
  const [city, setCity] = useState(initial.city)
  const [area, setArea] = useState(initial.area)
  const [address, setAddress] = useState(initial.address)
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---------------------------------------------------------------- phone ---
  const [phone, setPhone] = useState(initial.phone)
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpMsg, setOtpMsg] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [phoneVerified, setPhoneVerified] = useState(initial.phoneVerified)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // A changed number is an unverified number until a code comes back. Showing
  // "Verified" beside digits nobody has proved is the whole failure this
  // guards against.
  const phoneChanged = phone.replace(/\D/g, '') !== initial.phone.replace(/\D/g, '')

  // Curated cities/areas from the DB (migration 73). City and Area accept free
  // text (a datalist) so a parent whose locality is not one of the 23 cities is
  // never blocked — the typed value round-trips as a plain string.
  const { map } = useCityAreas()
  const areas = areasForCity(map, city)

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/parent/profile', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, city, area, address, avatarUrl: avatarUrl ?? '' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save your details.')
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your details.')
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    const path = `${initial.userId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (upErr) throw new Error(upErr.message)
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)

    // Saved immediately rather than waiting for the Save button. A picture is
    // not part of the form the way a name is — somebody who uploads one and
    // navigates away expects it to have stuck.
    const res = await fetch('/api/parent/profile', { signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, city, area, address, avatarUrl: data.publicUrl }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Could not save that picture.')
    setAvatarUrl(data.publicUrl)
    toast.success('Photo updated.')
    router.refresh()
  }

  const sendCode = async () => {
    setOtpMsg(null)
    setError(null)
    const res = await fetch('/api/auth/otp', { signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', phone }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Could not send a code.')
      if (json.retryAfterSeconds) setCooldown(json.retryAfterSeconds)
      return
    }
    setOtpSent(true)
    setCooldown(5 * 60)
    setOtpMsg(json.devBypassActive ? 'Development mode: use the DEV_DEFAULT_OTP code.' : 'Code sent.')
  }

  const verifyCode = async () => {
    setOtpMsg(null)
    setError(null)
    const res = await fetch('/api/auth/otp', { signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', phone, code: otp }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'That code did not work.')
      return
    }
    setPhoneVerified(true)
    setOtpSent(false)
    setOtp('')
    setOtpMsg('Number verified.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red-hover">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------- picture --- */}
      <Card title="Your picture" hint="Tutors see this on the tuitions you post. It is not contact information.">
        {/* One control, square. The picture used to sit in an <Avatar> beside
            a full-width drop zone, so after a successful upload the zone said
            "Tap to choose" while the avatar next to it showed the new photo --
            two components disagreeing about whether anything had happened. */}
        <FileUpload
          label="Profile picture"
          acceptLabel="JPG or PNG"
          shape="square"
          maxBytes={5 * 1024 * 1024}
          onFile={uploadAvatar}
          hint="A clear photo of your face helps tutors recognise you."
          currentPreview={
            <Avatar
              name={fullName || 'You'}
              src={avatarUrl}
              seed={initial.userId}
              decorative
              ring=""
              className="h-full w-full rounded-none text-xl"
            />
          }
        />
      </Card>

      {/* --------------------------------------------------------- about --- */}
      <Card title="Your details">
        <label className="block space-y-1">
          <span className={LABEL}>Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={FIELD} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={LABEL}>City</span>
            <input
              list="parent-city-options"
              value={city}
              onChange={(e) => {
                setCity(e.target.value)
                setArea('')
              }}
              placeholder="Choose or type your city"
              autoComplete="off"
              className={FIELD}
            />
            <datalist id="parent-city-options">
              {map.cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>Area</span>
            <input
              list="parent-area-options"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Choose or type your area"
              autoComplete="off"
              className={FIELD}
            />
            <datalist id="parent-area-options">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="block space-y-1">
          <span className={LABEL}>Home address</span>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={`${FIELD} py-2`}
          />
          <span className="block text-[11px] text-gray-500">
            Only you and our verification team see this. It is never on a job post.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={saving || fullName.trim().length < 2}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy disabled:opacity-50"
          >
            {saving && <Loader2 aria-hidden size={14} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && !saving && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-tm-green-deep">
              <Check aria-hidden size={14} />
              Saved
            </span>
          )}
        </div>
      </Card>

      {/* --------------------------------------------------------- phone --- */}
      <Card
        title="Mobile number"
        hint="Changing it needs a new code — we have to know the new number reaches you."
      >
        <label className="block space-y-1">
          <span className={LABEL}>Number</span>
          <input
            value={phone}
            inputMode="tel"
            onChange={(e) => {
              setPhone(e.target.value)
              setOtpSent(false)
              if (e.target.value.replace(/\D/g, '') !== initial.phone.replace(/\D/g, '')) {
                setPhoneVerified(false)
              } else {
                setPhoneVerified(initial.phoneVerified)
              }
            }}
            placeholder="03214567890"
            className={FIELD}
          />
        </label>

        {phoneVerified && !phoneChanged ? (
          <p className="inline-flex items-center gap-1.5 rounded-xl bg-tm-tint-green px-3 py-2 text-xs font-bold text-tm-green-deep">
            <Check aria-hidden size={14} />
            This number is verified
          </p>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={sendCode}
              disabled={cooldown > 0 || phone.replace(/\D/g, '').length < 10}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy disabled:opacity-50 sm:w-auto"
            >
              {cooldown > 0 ? `Resend in ${mmss(cooldown)}` : otpSent ? 'Resend code' : 'Send code'}
            </button>
            {otpSent && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  inputMode="numeric"
                  placeholder="000000"
                  aria-label="Verification code"
                  className={FIELD}
                />
                <button
                  type="button"
                  onClick={verifyCode}
                  disabled={otp.trim().length < 4}
                  className="gap-1.5 inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                >
                  <ShieldCheck aria-hidden size={14} />
                  Verify
                </button>
              </div>
            )}
          </div>
        )}
        {otpMsg && <p className="text-[11px] font-semibold text-tm-green-deep">{otpMsg}</p>}
      </Card>

      {/* --------------------------------------------------------- email --- */}
      <Card
        title={initial.email ? 'Email address' : 'Add an email'}
        hint="For receipts and reminders — and you can sign in with it too. Your mobile number keeps working either way."
      >
        <label className="block space-y-1">
          <span className={LABEL}>Email</span>
          <input
            value={email}
            type="email"
            inputMode="email"
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className={FIELD}
          />
        </label>
        <button
          type="button"
          onClick={saveEmail}
          disabled={emailBusy || !emailChanged || !looksLikeEmail(email.trim())}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy disabled:opacity-50"
        >
          {emailBusy ? 'Saving…' : initial.email ? 'Update email' : 'Add email'}
        </button>
      </Card>
    </div>
  )
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="space-y-0.5">
        <h2 className="text-sm font-black text-tm-navy">{title}</h2>
        {hint && <p className="text-[11px] leading-relaxed text-gray-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
