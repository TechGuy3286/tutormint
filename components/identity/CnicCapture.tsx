'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import CnicCameraField from '@/components/tutor/CnicCameraField'
import { FormChecklist } from '@/components/forms/FormChecklist'
import type { ChecklistItem } from '@/lib/formChecklist'
import { formatCnic, isValidCnic, CNIC_FORMAT_HINT } from '@/lib/cnic'

// The ONE shared CNIC entry (PR81), used everywhere a CNIC is typed and
// photographed: the tutor onboarding CNIC step, the tutor Settings identity card,
// the apply/platform-fee verify gate, and (via IdentityCard) parent verification.
//
// It owns exactly the parts that were duplicated across those surfaces:
//   • the number input, with automatic 5-7-1 dashes (formatCnic) and the one
//     format check (isValidCnic),
//   • the front and back photo tiles (the shared CnicCameraField — same camera/
//     file options, size/MIME limits, compression and preview),
//   • the PR80 FormChecklist ("1. Type your CNIC number · 2. Photo of the front ·
//     3. Photo of the back"),
//   • the "save the number before an image" gate, which every surface needs so a
//     queue card never has photos with no number to check them against.
//
// It does NOT own the surrounding flow: the submit endpoint, the checkout, the
// masked saved-number display or the Waiting/Approved/Rejected status. Each
// surface keeps those and reads readiness through `onState`. English + Urdu.

export type CnicCaptureState = {
  /** The formatted number (xxxxx-xxxxxxx-x). */
  number: string
  /** 13 digits present. */
  valid: boolean
  front: boolean
  back: boolean
  /** valid && front && back — the surface enables its submit on this. */
  ready: boolean
}

/** The three CNIC checklist items — shared so a surface can show the
 *  <ChecklistStatus> line under its own submit button with the same wording. */
export function cnicChecklistItems(s: { valid: boolean; front: boolean; back: boolean }): ChecklistItem[] {
  return [
    { en: 'Type your CNIC number', ur: 'اپنا شناختی کارڈ نمبر لکھیں', done: s.valid },
    { en: 'Add a photo of the front', ur: 'سامنے کے رخ کی تصویر لگائیں', done: s.front },
    { en: 'Add a photo of the back', ur: 'پچھلے رخ کی تصویر لگائیں', done: s.back },
  ]
}

export default function CnicCapture({
  initialNumber = '',
  initialFront = false,
  initialBack = false,
  frontStoredPreview,
  backStoredPreview,
  onUploaded,
  onState,
}: {
  initialNumber?: string
  initialFront?: boolean
  initialBack?: boolean
  /** A node rendering an already-stored front/back document (e.g. a watermarked
   *  SecureDocumentPreview) — for surfaces like IdentityCard that show the card a
   *  returning member already uploaded. */
  frontStoredPreview?: ReactNode
  backStoredPreview?: ReactNode
  /** Fires with the new document id after a side uploads, so a surface can track
   *  the doc (IdentityCard uses it for its status-mode previews). */
  onUploaded?: (side: 'front' | 'back', documentId: string) => void
  onState?: (s: CnicCaptureState) => void
}) {
  const [number, setNumber] = useState(formatCnic(initialNumber))
  const [front, setFront] = useState(initialFront)
  const [back, setBack] = useState(initialBack)
  const [error, setError] = useState<string | null>(null)

  const valid = isValidCnic(number)
  const ready = valid && front && back

  useEffect(() => {
    onState?.({ number, valid, front, back, ready })
    // onState is a plain callback the parent recreates each render; depending on
    // the derived values only keeps this to real changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, valid, front, back, ready])

  // Save the number before a side uploads (same rule everywhere): the images
  // cannot be actioned by the admin without a number to compare against. Shared
  // /api/identity save-number endpoint — this route is identical on every surface.
  const ensureNumber = useCallback(async (): Promise<boolean> => {
    if (!isValidCnic(number)) {
      setError(CNIC_FORMAT_HINT)
      return false
    }
    const r = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-number', cnicNumber: number }),
    })
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? 'Could not save your CNIC number.')
      return false
    }
    setError(null)
    return true
  }, [number])

  return (
    <div className="space-y-4">
      <FormChecklist items={cnicChecklistItems({ valid, front, back })} />
      <input
        value={number}
        inputMode="numeric"
        onChange={(e) => setNumber(formatCnic(e.target.value))}
        placeholder="CNIC number, e.g. 35201-1234567-1"
        aria-label="CNIC number"
        className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy"
      />
      {/* Front + back, side by side. Each fills with the real photo once taken. */}
      <div className="flex gap-3">
        <CnicCameraField
          side="front"
          label="Front"
          urdu="سامنے کا رخ"
          storedPreview={frontStoredPreview}
          beforeUpload={ensureNumber}
          onUploaded={(id) => { setFront(true); onUploaded?.('front', id) }}
          onError={(m) => setError(m || null)}
        />
        <CnicCameraField
          side="back"
          label="Back"
          urdu="پچھلا رخ"
          storedPreview={backStoredPreview}
          beforeUpload={ensureNumber}
          onUploaded={(id) => { setBack(true); onUploaded?.('back', id) }}
          onError={(m) => setError(m || null)}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500">
        Only our verification team sees it. It never appears on your profile.
      </p>
      <p className="text-[11px] leading-relaxed text-gray-500" lang="ur" dir="rtl">
        صرف ہماری تصدیقی ٹیم دیکھتی ہے۔ یہ کبھی آپ کے پروفائل پر ظاہر نہیں ہوتا۔
      </p>
      {error && <p role="alert" className="text-[11px] font-bold text-tm-red">{error}</p>}
    </div>
  )
}
