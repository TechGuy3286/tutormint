'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import CnicCameraField from '@/components/tutor/CnicCameraField'
import { FormChecklist } from '@/components/forms/FormChecklist'
import type { ChecklistItem } from '@/lib/formChecklist'
import { formatCnic, isValidCnic, CNIC_FORMAT_HINT, CNIC_FORMAT_HINT_UR_LEAD, CNIC_EXAMPLE } from '@/lib/cnic'
import { Ltr } from '@/components/onboarding/StepLayout'
import { fieldState, fieldStateClasses } from '@/lib/onboarding/fieldState'
import { useDocLocks } from '@/lib/useDocLocks'
import DocLockNotice, { combinedView } from '@/components/identity/DocLockNotice'
import { useCnicSuggestion } from '@/lib/useCnicSuggestion'
import { CNIC_SUGGESTED_MEMBER, CNIC_SUGGESTED_MEMBER_UR } from '@/lib/cnicReaderCore'
import { normaliseCnic } from '@/lib/cnic'

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
  uploadUrl,
  uploadExtra,
  saveNumber,
  show = 'all',
  hideChecklist = false,
}: {
  initialNumber?: string
  initialFront?: boolean
  initialBack?: boolean
  /** PR106-D §1.2 — render only the number field, only the photo tiles, or both.
   *  The onboarding CNIC step is split across two screens that each reuse this. */
  show?: 'all' | 'number' | 'photos'
  /** A node rendering an already-stored front/back document (e.g. a watermarked
   *  SecureDocumentPreview) — for surfaces like IdentityCard that show the card a
   *  returning member already uploaded. */
  frontStoredPreview?: ReactNode
  backStoredPreview?: ReactNode
  /** Fires with the new document id after a side uploads, so a surface can track
   *  the doc (IdentityCard uses it for its status-mode previews). */
  onUploaded?: (side: 'front' | 'back', documentId: string) => void
  onState?: (s: CnicCaptureState) => void
  /** PR83: the staff editor points the image upload at the service-role admin
   *  route and passes the target tutor via uploadExtra; members keep the
   *  defaults. */
  uploadUrl?: string
  uploadExtra?: Record<string, string>
  /** PR83: override how the number is saved before an image (the staff editor
   *  saves it to the target tutor). Default = the member /api/identity path. */
  saveNumber?: (number: string) => Promise<{ ok: boolean; error?: string }>
  /** PR106-F §3 — the onboarding steps hide the numbered checklist (the button
   *  simply stays disabled until valid). Settings/parent-verify keep it. */
  hideChecklist?: boolean
}) {
  const [number, setNumber] = useState(formatCnic(initialNumber))
  const [front, setFront] = useState(initialFront)
  const [back, setBack] = useState(initialBack)
  const [error, setError] = useState<string | null>(null)

  const valid = isValidCnic(number)
  const ready = valid && front && back

  // Approved documents are locked (owner, 9 Oct 2026). Only the member's own
  // upload path reads the lock; the staff editor (a custom uploadUrl) is not
  // locked — staff can always replace a document.
  const memberUpload = !uploadUrl || uploadUrl === '/api/documents/upload'
  const locks = useDocLocks(memberUpload)
  const frontView = locks?.cnicFront ?? 'open'
  const backView = locks?.cnicBack ?? 'open'
  const sidesView = combinedView([frontView, backView])
  // An approved CNIC's number is locked with it.
  const numberLocked = frontView !== 'open' || backView !== 'open'

  // READ FROM THE PHOTO (owner, 10 Oct 2026). A member who uploaded a CNIC
  // front without typing the number gets the box PRE-FILLED with the number
  // read from that photo, and a line asking them to check it. It is only a
  // suggestion in the box: it is saved when THEY press Next / Save, through the
  // same save-number path as a typed number — never silently.
  const suggestion = useCnicSuggestion(memberUpload && show !== 'photos' && !formatCnic(initialNumber))
  const [suggestionUsed, setSuggestionUsed] = useState(false)
  if (suggestion && !suggestionUsed) {
    setSuggestionUsed(true)
    if (!number && !numberLocked) setNumber(formatCnic(suggestion))
  }
  const showsSuggestion = !!suggestion && normaliseCnic(number) === normaliseCnic(suggestion)

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
    // PR83: a staff editor supplies its own save (targets the tutor); the
    // default is the member's self-scoped /api/identity save-number.
    if (saveNumber) {
      const res = await saveNumber(number)
      if (!res.ok) {
        setError(res.error ?? 'Could not save the CNIC number.')
        return false
      }
      setError(null)
      return true
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
  }, [number, saveNumber])

  const items = cnicChecklistItems({ valid, front, back })
  const shownItems =
    show === 'number' ? items.slice(0, 1) : show === 'photos' ? items.slice(1) : items

  return (
    <div className="space-y-4">
      {!hideChecklist && <FormChecklist items={shownItems} />}
      {show !== 'photos' && (
        <>
          <input
            value={number}
            inputMode="numeric"
            onChange={(e) => setNumber(formatCnic(e.target.value))}
            readOnly={numberLocked}
            placeholder="CNIC number, e.g. 35201-1234567-1"
            aria-label="CNIC number"
            className={`min-h-[48px] w-full rounded-xl border p-3 text-sm outline-none ${fieldStateClasses(
              fieldState({ value: number, valid }),
            )}`}
          />
          {showsSuggestion && (
            <p role="status" className="-mt-1.5 rounded-lg bg-tm-tint-gold p-2 text-[11px] font-semibold text-tm-gold-ink">
              {CNIC_SUGGESTED_MEMBER}
              <span lang="ur" dir="rtl" className="mt-0.5 block">{CNIC_SUGGESTED_MEMBER_UR}</span>
            </p>
          )}
          {/* PR106-B §12 / PR106-F §5: the format hint, English with Urdu under it.
              The example number is kept in an LTR isolate so it reads
              42101-1234567-1 inside the RTL Urdu line, not reversed. */}
          <p className="-mt-1.5 text-[11px] text-gray-500">
            {CNIC_FORMAT_HINT}
            <span lang="ur" dir="rtl" className="mt-0.5 block">
              {CNIC_FORMAT_HINT_UR_LEAD} <Ltr>{CNIC_EXAMPLE}</Ltr>۔
            </span>
          </p>
        </>
      )}
      {/* Front + back, side by side. Each fills with the real photo once taken. */}
      {show !== 'number' && (
      <div className="flex gap-3">
        <CnicCameraField
          side="front"
          label="Front"
          urdu="سامنے کا رخ"
          storedPreview={frontStoredPreview}
          beforeUpload={ensureNumber}
          onUploaded={(id) => { setFront(true); onUploaded?.('front', id) }}
          onError={(m) => setError(m || null)}
          uploadUrl={uploadUrl}
          uploadExtra={uploadExtra}
          lockView={frontView}
        />
        <CnicCameraField
          side="back"
          label="Back"
          urdu="پچھلا رخ"
          storedPreview={backStoredPreview}
          beforeUpload={ensureNumber}
          onUploaded={(id) => { setBack(true); onUploaded?.('back', id) }}
          onError={(m) => setError(m || null)}
          uploadUrl={uploadUrl}
          uploadExtra={uploadExtra}
          lockView={backView}
        />
      </div>
      )}
      {show !== 'number' && memberUpload && <DocLockNotice view={sidesView} />}
      {show !== 'number' && (
        <>
          <p className="text-[11px] leading-relaxed text-gray-500">
            Only our verification team sees it. It never appears on your profile.
          </p>
          <p className="text-[11px] leading-relaxed text-gray-500" lang="ur" dir="rtl">
            صرف ہماری تصدیقی ٹیم دیکھتی ہے۔ یہ کبھی آپ کے پروفائل پر ظاہر نہیں ہوتا۔
          </p>
        </>
      )}
      {error && <p role="alert" className="text-[11px] font-bold text-tm-red">{error}</p>}
    </div>
  )
}
