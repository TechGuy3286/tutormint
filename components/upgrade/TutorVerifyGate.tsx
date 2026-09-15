'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import CnicCameraField from '@/components/tutor/CnicCameraField'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'

// The verification gate an UNVERIFIED tutor meets when they tap Apply (owner,
// 15 Sep 2026). Deliberately minimal — a tutor on a phone does not read paragraphs:
//
//   * one line ("Upload your CNIC, front and back."),
//   * CNIC FRONT and BACK inline — the SHARED CnicCameraField (PR 3b §2.1), the
//     same capture the Settings identity card uses: camera opens directly, the
//     tile fills with the photo, tap to retake, compressed under 1 MB,
//   * one small privacy line, the one permitted claim, and two buttons.
//
// The images save to the tutor's profile automatically (kind 'cnic' — the private
// identity-docs bucket; never re-uploaded elsewhere, never shown publicly).
// "Verify" routes to the payment page and does nothing else — NO price here.

type Side = 'front' | 'back'

export default function TutorVerifyGate({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [done, setDone] = useState<{ front: boolean; back: boolean }>({ front: false, back: false })
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [stuck, setStuck] = useState<string | null>(null)

  const both = done.front && done.back

  const markDone = (side: Side) => setDone((d) => ({ ...d, [side]: true }))

  async function verify() {
    setStarting(true)
    setError(null)
    // The one-time fee is a checkout for the 'verified' fee marker (Rs 199).
    const { ok, data, error: failed } = await submitJson<{ mode?: string; url?: string; next?: string }>(
      '/api/payments/checkout',
      { planCode: 'verified' },
    )
    if (!ok || !data) {
      setError(failed ?? 'Could not start the payment.')
      setStarting(false)
      return
    }
    const target = data.mode === 'redirect' ? (data.url ?? '') : (data.next ?? '')
    if (!target) {
      setError('Could not start the payment.')
      setStarting(false)
      return
    }
    armEscape(() => {
      setStarting(false)
      setStuck(target)
      setError(STUCK_MESSAGE)
    })
    if (data.mode === 'redirect') {
      window.location.assign(target)
      return
    }
    router.push(target)
  }

  return (
    <div className="mt-3 space-y-4">
      {/* One line — what to do. Nothing about what verification is, or the fee. */}
      <p className="flex flex-col leading-tight">
        <span className="text-xs font-semibold text-slate-700">Upload your CNIC, front and back.</span>
        <span className="text-[11px] text-gray-500" lang="ur" dir="rtl">
          اپنا شناختی کارڈ اپلوڈ کریں — سامنے اور پیچھے
        </span>
      </p>

      {/* Front + back, side by side. Each fills with the real photo once taken. */}
      <div className="flex gap-3">
        <CnicCameraField
          side="front"
          label="Front"
          urdu="سامنے کا رخ"
          onUploaded={() => markDone('front')}
          onError={(m) => setError(m || null)}
        />
        <CnicCameraField
          side="back"
          label="Back"
          urdu="پچھلا رخ"
          onUploaded={() => markDone('back')}
          onError={(m) => setError(m || null)}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-gray-500">
        Only our verification team sees it. Never on your profile.
      </p>

      {/* The apply-gate green box (owner PR): the capability verifying unlocks —
          applying. Not an outcome promise (no replies, students or income). */}
      <p className="flex flex-col gap-0.5 rounded-xl bg-tm-tint-green p-3 leading-tight text-tm-green-deep">
        <span className="text-xs font-bold">Once verified, you can apply to tuitions and jobs.</span>
        <span className="text-[11px] font-semibold" lang="ur" dir="rtl">
          تصدیق کے بعد آپ ٹیوشنز اور جابز کے لیے اپلائی کر سکتے ہیں۔
        </span>
      </p>

      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-[11px] font-bold text-tm-red">{error}</p>
          {stuck && <SubmitEscape href={stuck} />}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={!both || starting}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          {starting ? 'Starting…' : 'Verify'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
