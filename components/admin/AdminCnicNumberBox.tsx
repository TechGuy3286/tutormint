'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatCnic, isValidCnic } from '@/lib/cnic'

// The CNIC number box on the tutor's review card (owner, 9 Oct 2026). The
// number stays required for tutor CNIC approval; staff type it here and save in
// one step — with or without dashes, stored as 42101-1234567-1 by the route.
// A number already on file is shown heavily masked (the full number is only
// revealed through the logged "Show"); "Change" opens an empty box.

export const CNIC_NUMBER_BOX_ID = 'cnic-number-box'
export const CNIC_NUMBER_NOT_13 = 'The CNIC number must be 13 digits, like 42101-1234567-1.'

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
    toast.success('CNIC number saved. You can approve now.')
    router.refresh()
  }

  return (
    <div
      id={CNIC_NUMBER_BOX_ID}
      className={`scroll-mt-24 space-y-1.5 rounded-lg border p-2 ${highlight && !saved ? 'border-tm-red bg-tm-tint-red' : 'border-gray-200'}`}
    >
      <p className="text-[11px] font-bold text-tm-navy">CNIC number</p>
      {saved && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-slate-700">{saved}</span>
          {canEdit && !readOnly && (
            <button type="button" onClick={() => setEditing(true)} className="min-h-[28px] text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline">
              Change
            </button>
          )}
        </div>
      ) : canEdit && !readOnly ? (
        <div className="flex flex-wrap gap-1.5">
          <input
            value={value}
            inputMode="numeric"
            onChange={(e) => { setValue(formatCnic(e.target.value)); setError(null) }}
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
      ) : (
        <p className="text-[11px] text-gray-500">Not entered.</p>
      )}
      {error && <p role="alert" className="text-[11px] font-semibold text-tm-red">{error}</p>}
    </div>
  )
}
