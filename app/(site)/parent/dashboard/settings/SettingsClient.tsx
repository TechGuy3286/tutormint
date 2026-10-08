'use client'

import { submitSignal } from '@/lib/submit'

import { Check, Loader2, Image as ImageIcon, UserRound, Smartphone, Mail } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import Avatar from '@/components/Avatar'
import FileUpload from '@/components/FileUpload'
import { useCityAreas } from '@/lib/cityAreas'
import { areasForCity } from '@/lib/cityAreasCore'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import EmailCard from '@/components/account/EmailCard'
import PauseAccountCard from '@/components/account/PauseAccountCard'
import ChangePasswordCard from '@/components/account/ChangePasswordCard'
import { Lock, PauseCircle } from 'lucide-react'
import MobileNumberInput from '@/components/auth/MobileNumberInput'
import OtpCodeEntry from '@/components/auth/OtpCodeEntry'
import { whatsappHref, SUPPORT_WHATSAPP_FALLBACK } from '@/lib/supportContacts'
import { SettingsTile, OpenTileHeader } from '@/components/tutor/SettingsPieces'
import { STATUS_META, type CardStatus } from '@/lib/tutorSettingsCopy'
import { FormChecklist, ChecklistStatus } from '@/components/forms/FormChecklist'

// PR17 §3.2 — a verified number is changed through support. The number is the one
// client-safe constant; a client component cannot read the app_settings override.
const mobileSupportHref = whatsappHref(
  SUPPORT_WHATSAPP_FALLBACK,
  'Assalam-o-Alaikum, I need to change the mobile number on my TutorMint account.',
)

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

  // Email is its own shared card now (EmailCard, PR29 §4): adding one sends a
  // confirmation LINK and shows "Email not confirmed" until it is clicked,
  // rather than saving it pre-confirmed here.

  const [fullName, setFullName] = useState(initial.fullName)
  const [city, setCity] = useState(initial.city)
  const [area, setArea] = useState(initial.area)
  const [address, setAddress] = useState(initial.address)
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // PR77: parent Settings uses the same tile grid + in-place expansion as the
  // tutor side. One tile open at a time; Save or the × shrinks it back.
  const [openKey, setOpenKey] = useState<string | null>(null)
  // ?open=mobile (the "verify your mobile" gate links here) opens that tile.
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('open')
    if (k) setOpenKey(k)
  }, [])
  const openRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (openKey && openRef.current) openRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [openKey])

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
      setOpenKey(null) // Save shrinks the tile back (PR77).
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
      return
    }
    setOtpSent(true)
    // PR16 §3 — one code, no resend/countdown. A second send returns alreadySent.
    setOtpMsg(
      json.devBypassActive
        ? 'Development mode: use the DEV_DEFAULT_OTP code.'
        : json.alreadySent
          ? 'We already sent a code to this number. Please use it.'
          : 'Code sent.',
    )
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
    setOpenKey(null) // Verified — shrink the tile back (PR77).
    router.refresh()
  }

  const pictureStatus: CardStatus = avatarUrl ? 'completed' : 'missing'
  const detailsStatus: CardStatus =
    fullName.trim().length >= 2 && !!city.trim() && !!area.trim() ? 'completed' : 'missing'
  const mobileStatus: CardStatus = phoneVerified ? 'completed' : 'missing'

  // The tiles, in order. Rendered as a 2-column grid where the OPEN tile's panel
  // appears full-width in the row directly after its own row (PR83 Part A.2) —
  // no grid-flow-row-dense, so the other tiles keep their order. Every field
  // label carries its Urdu line (Part A.3).
  const parentTiles: {
    key: string
    icon: ReactNode
    title: string
    titleUr: string
    status: CardStatus
    hint?: string
    body: ReactNode
  }[] = [
    {
      key: 'picture',
      icon: <ImageIcon aria-hidden size={20} />,
      title: 'Your picture',
      titleUr: 'آپ کی تصویر',
      status: pictureStatus,
      hint: 'Tutors see this on the tuitions you post. It is not contact information.',
      body: (
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
      ),
    },
    {
      key: 'details',
      icon: <UserRound aria-hidden size={20} />,
      title: 'Your details',
      titleUr: 'آپ کی تفصیلات',
      status: detailsStatus,
      body: (
        <>
          <label className="block space-y-1">
            <span className={LABEL}>Full name</span>
            <FieldUr>پورا نام</FieldUr>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={FIELD} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className={LABEL}>City</span>
              <FieldUr>شہر</FieldUr>
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
              <FieldUr>علاقہ</FieldUr>
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
            <FieldUr>گھر کا پتہ</FieldUr>
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

          {/* Self-explaining checklist (PR80) — mirrors the Save gate (name ≥ 2). */}
          <FormChecklist
            items={[
              { en: 'Type your full name', ur: 'اپنا پورا نام لکھیں', done: fullName.trim().length >= 2 },
              { en: 'Add your city', ur: 'اپنا شہر شامل کریں', done: !!city.trim(), optional: true },
              { en: 'Add your home address', ur: 'اپنا گھر کا پتہ شامل کریں', done: !!address.trim(), optional: true },
            ]}
          />

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
          <ChecklistStatus
            items={[
              { en: 'Type your full name', ur: 'اپنا پورا نام لکھیں', done: fullName.trim().length >= 2 },
              { en: 'Add your city', ur: 'اپنا شہر شامل کریں', done: !!city.trim(), optional: true },
              { en: 'Add your home address', ur: 'اپنا گھر کا پتہ شامل کریں', done: !!address.trim(), optional: true },
            ]}
          />
        </>
      ),
    },
    {
      key: 'mobile',
      icon: <Smartphone aria-hidden size={20} />,
      title: 'Mobile number',
      titleUr: 'موبائل نمبر',
      status: mobileStatus,
      hint: initial.phoneVerified
        ? 'Your verified number.'
        : 'We send a 6-digit code to check the number reaches you. You can change the number before verifying.',
      body: initial.phoneVerified ? (
        <>
          <p className="inline-flex items-center gap-1.5 rounded-xl bg-tm-tint-green px-3 py-2 text-xs font-bold text-tm-green-deep">
            <Check aria-hidden size={14} />
            {initial.phone} — verified
          </p>
          <p className="text-[11px] leading-relaxed text-gray-500">
            Need to change it?{' '}
            {mobileSupportHref ? (
              <a
                href={mobileSupportHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-tm-green-deep hover:underline"
              >
                Contact support on WhatsApp
              </a>
            ) : (
              'Contact support.'
            )}
          </p>
        </>
      ) : (
        <>
          <label className="block space-y-1">
            <span className={LABEL}>Number</span>
            <FieldUr>نمبر</FieldUr>
            {/* Shared mobile input (PR82). */}
            <MobileNumberInput
              value={phone}
              onChange={(v) => {
                setPhone(v)
                setOtpSent(false)
              }}
              className={FIELD}
            />
          </label>

          <div className="space-y-2">
            {!otpSent && (
              <button
                type="button"
                onClick={sendCode}
                disabled={phone.replace(/\D/g, '').length < 10}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy disabled:opacity-50 sm:w-auto"
              >
                Send code
              </button>
            )}
            {otpSent && (
              <OtpCodeEntry
                code={otp}
                onChange={setOtp}
                onVerify={verifyCode}
                label=""
                autoFocus={false}
                onDifferentNumber={() => setOtpSent(false)}
              />
            )}
          </div>
          {otpMsg && <p className="text-[11px] font-semibold text-tm-green-deep">{otpMsg}</p>}
        </>
      ),
    },
    {
      key: 'email',
      icon: <Mail aria-hidden size={20} />,
      title: 'Email',
      titleUr: 'ای میل',
      status: 'neutral',
      body: <EmailCard />,
    },
    {
      // Change password (owner, 8 Oct 2026) — the same card tutors have, before
      // "Pause my account".
      key: 'password',
      icon: <Lock aria-hidden size={20} />,
      title: 'Change password',
      titleUr: 'پاس ورڈ تبدیل کریں',
      status: 'neutral',
      body: <ChangePasswordCard />,
    },
    {
      // "Pause my account" (owner, 8 Oct 2026), after Change password.
      key: 'pause',
      icon: <PauseCircle aria-hidden size={20} />,
      title: 'Pause my account',
      titleUr: 'اپنا اکاؤنٹ روکیں',
      status: 'neutral',
      body: <PauseAccountCard />,
    },
  ]

  const tileRows: (typeof parentTiles)[] = []
  for (let i = 0; i < parentTiles.length; i += 2) tileRows.push(parentTiles.slice(i, i + 2))

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red-hover">
          {error}
        </p>
      )}

      {/* PR83 (Part A.2): a two-column grid; the open tile's panel appears
          full-width in the row directly after its own row, the rest keep order
          (no grid-flow-row-dense). One tile open at a time. */}
      <ul className="grid grid-cols-2 gap-3">
        {tileRows.map((row, ri) => {
          const openInRow = row.find((t) => t.key === openKey)
          return (
            <Fragment key={ri}>
              {row.map((t) => (
                <li key={t.key}>
                  <SettingsTile
                    status={t.status}
                    icon={t.icon}
                    title={t.title}
                    titleUr={t.titleUr}
                    open={openKey === t.key}
                    onClick={() => setOpenKey(openKey === t.key ? null : t.key)}
                  />
                </li>
              ))}
              {openInRow && (
                <li ref={openRef} className="col-span-2 scroll-mt-4">
                  <section className={`space-y-3 rounded-2xl border p-4 sm:p-5 ${STATUS_META[openInRow.status].card}`}>
                    <OpenTileHeader
                      title={openInRow.title}
                      titleUr={openInRow.titleUr}
                      status={openInRow.status}
                      onClose={() => setOpenKey(null)}
                    />
                    {openInRow.hint && <p className="text-[11px] leading-relaxed text-gray-500">{openInRow.hint}</p>}
                    {openInRow.body}
                  </section>
                </li>
              )}
            </Fragment>
          )
        })}
      </ul>
    </div>
  )
}

// The Urdu line under a field label (PR83 Part A.3). Body text, so it keeps the
// PR76 body size (no tm-ur-cap) — matching the onboarding field labels.
function FieldUr({ children }: { children: ReactNode }) {
  return (
    <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">
      {children}
    </span>
  )
}
