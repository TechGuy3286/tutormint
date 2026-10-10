'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Save, ScanText } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatCnic, isValidCnic, normaliseCnic } from '@/lib/cnic'
import { CNIC_DUPLICATE_STAFF, CNIC_NOT_READ_STAFF, CNIC_SUGGESTED_STAFF } from '@/lib/cnicReaderCore'

// The CNIC number box on the tutor's review card (owner, 9 Oct 2026). The
// number stays required for tutor CNIC approval; staff type it here and save in
// one step — with or without dashes, stored as 42101-1234567-1 by the route.
// A number already on file is shown heavily masked (the full number is only
// revealed through the logged "Show"); "Change" opens an empty box.
//
// READ NUMBER FROM PHOTO (owner, 10 Oct 2026). The button reads the 13 digits
// off the CNIC front and FILLS THE BOX — a suggestion to check against the
// image. Nothing is saved until staff press Save (or Approve, which needs the
// saved number), exactly as with a typed number. A suggestion already on file
// (the backlog run, or the read made when the member uploaded) pre-fills an
// empty box the same way. If the number is already on another account, staff
// see a warning with a link; it never blocks.

export const CNIC_NUMBER_BOX_ID = 'cnic-number-box'
export const CNIC_NUMBER_NOT_13 = 'The CNIC number must be 13 digits, like 42101-1234567-1.'

type Duplicate = { id: string; name: string } | null
type ReadReply = { status?: 'found' | 'none' | 'pending' | 'unavailable'; number?: string | null; duplicate?: Duplicate; error?: string }

const READ_URL = '/api/admin/documents/read-cnic'
const post = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** "This CNIC number is already on another account: Name" — staff only. */
export function CnicDuplicateWarning({ duplicate }: { duplicate: Duplicate }) {
  if (!duplicate) return null
  return (
    <p role="status" className="rounded-lg border border-tm-gold/40 bg-tm-tint-gold p-2 text-[11px] font-semibold text-tm-gold-ink">
      {CNIC_DUPLICATE_STAFF}:{' '}
      <Link href={`/admin/users/${duplicate.id}`} target="_blank" className="font-black underline underline-offset-2">
        {duplicate.name}
      </Link>
    </p>
  )
}

/** The duplicate warning for a member's SAVED number (the parent card, which has no number box). */
export function SavedCnicDuplicate({ memberId }: { memberId: string }) {
  const readOnly = useAdminReadOnly()
  const [duplicate, setDuplicate] = useState<Duplicate>(null)
  useEffect(() => {
    if (readOnly) return
    let live = true
    void adminFetch<{ duplicate?: Duplicate }>(READ_URL, post({ memberId, action: 'check' })).then(({ ok, data }) => {
      if (live && ok) setDuplicate(data?.duplicate ?? null)
    })
    return () => {
      live = false
    }
  }, [memberId, readOnly])
  return <CnicDuplicateWarning duplicate={duplicate} />
}

export default function AdminCnicNumberBox({
  tutorId,
  maskedNumber,
  canEdit,
  highlight = false,
}: {
  tutorId: string
  /** XXXXX-XXXXXXX-4, or null when no number is on file. */
  maskedNumber: string | null
  canEdit: boolean
  /** Draw attention to the box (an Approve was refused for a missing number). */
  highlight?: boolean
}) {
  const readOnly = useAdminReadOnly()
  const toast = useToast()
  const router = useRouter()
  const [saved, setSaved] = useState<string | null>(maskedNumber)
  const [editing, setEditing] = useState(!maskedNumber)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  /** The number the reader suggested; the note shows while the box still holds it. */
  const [suggested, setSuggested] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<Duplicate>(null)
  const mayWrite = canEdit && !readOnly

  // On open: a saved number is checked for a duplicate; an empty box is
  // pre-filled from a suggestion already on file. Neither calls the reader.
  useEffect(() => {
    if (!mayWrite) return
    let live = true
    void adminFetch<ReadReply>(READ_URL, post({ memberId: tutorId, action: maskedNumber ? 'check' : 'cached' })).then(({ ok, data }) => {
      if (!live || !ok) return
      setDuplicate(data?.duplicate ?? null)
      if (!maskedNumber && data?.number) {
        setValue((cur) => cur || formatCnic(data.number))
        setSuggested(formatCnic(data.number))
      }
    })
    return () => {
      live = false
    }
  }, [tutorId, maskedNumber, mayWrite])

  // A typed number is checked against other accounts once it is 13 digits.
  useEffect(() => {
    if (!mayWrite || !editing || !isValidCnic(value)) return
    let live = true
    const timer = setTimeout(() => {
      void adminFetch<ReadReply>(READ_URL, post({ memberId: tutorId, action: 'check', cnicNumber: value })).then(({ ok, data }) => {
        if (live && ok) setDuplicate(data?.duplicate ?? null)
      })
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [value, editing, mayWrite, tutorId])

  const readFromPhoto = async () => {
    setReading(true)
    setError(null)
    setNote(null)
    const { ok, data } = await adminFetch<ReadReply>(READ_URL, post({ memberId: tutorId, action: 'read' }))
    setReading(false)
    if (!ok) {
      setError(data?.error ?? CNIC_NOT_READ_STAFF)
      return
    }
    if (data?.status === 'found' && data.number) {
      const n = formatCnic(data.number)
      setValue(n)
      setSuggested(n)
      setDuplicate(data.duplicate ?? null)
      return
    }
    setSuggested(null)
    setNote(data?.status === 'pending' ? 'Still reading the photo. Try again in a moment.' : CNIC_NOT_READ_STAFF)
  }

  const save = async () => {
    if (!isValidCnic(value)) {
      setError(CNIC_NUMBER_NOT_13)
      return
    }
    setBusy(true)
    setError(null)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/tutors/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-cnic-number', tutorId, cnicNumber: value, reason: 'CNIC number entered on the review card' }),
    })
    setBusy(false)
    if (!ok) {
      setError(data?.error ?? 'Could not save the CNIC number.')
      return
    }
    const d = formatCnic(value)
    setSaved(`XXXXX-XXXXXXX-${d.slice(-1)}`)
    setEditing(false)
    setValue('')
    setSuggested(null)
    setNote(null)
    toast.success('CNIC number saved. You can approve now.')
    router.refresh()
  }

  const showsSuggestion = !!suggested && normaliseCnic(value) === normaliseCnic(suggested)

  return (
    <div
      id={CNIC_NUMBER_BOX_ID}
      className={`scroll-mt-24 space-y-1.5 rounded-lg border p-2 ${highlight && !saved ? 'border-tm-red bg-tm-tint-red' : 'border-gray-200'}`}
    >
      <p className="text-[11px] font-bold text-tm-navy">CNIC number</p>
      {saved && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-slate-700">{saved}</span>
          {mayWrite && (
            <button type="button" onClick={() => setEditing(true)} className="min-h-[28px] text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline">
              Change
            </button>
          )}
        </div>
      ) : mayWrite ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={value}
              inputMode="numeric"
              onChange={(e) => { setValue(formatCnic(e.target.value)); setError(null); setDuplicate(null) }}
              placeholder="42101-1234567-1"
              aria-label="CNIC number"
              className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-gray-200 px-2 font-mono text-[11px] outline-none focus:border-tm-navy"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-tm-navy px-3 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Save size={12} aria-hidden />}
              Save
            </button>
          </div>
          <button
            type="button"
            onClick={() => void readFromPhoto()}
            disabled={reading}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-tm-navy px-2.5 text-[11px] font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-50"
          >
            {reading ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <ScanText size={12} aria-hidden />}
            Read number from photo
          </button>
          {showsSuggestion && <p role="status" className="text-[11px] font-semibold text-tm-gold-ink">{CNIC_SUGGESTED_STAFF}</p>}
          {note && !showsSuggestion && <p role="status" className="text-[11px] font-semibold text-slate-700">{note}</p>}
        </>
      ) : (
        <p className="text-[11px] text-gray-500">Not entered.</p>
      )}
      {!readOnly && <CnicDuplicateWarning duplicate={duplicate} />}
      {error && <p role="alert" className="text-[11px] font-semibold text-tm-red">{error}</p>}
    </div>
  )
}
