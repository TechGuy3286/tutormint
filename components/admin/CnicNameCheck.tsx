'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// The Name on CNIC beside the card (owner, 5 Nov 2026): the reviewer compares
// the name printed on the CNIC with the member's Name on CNIC. A staff reviewer
// (Backend Support) ticks "matches" before approving, or marks "does not
// match" — the CNIC is then the Owner's to decide. Only the Owner clears the
// mark (an Owner decision on the CNIC clears it too).

export default function CnicNameCheck({
  memberId,
  cnicName,
  mode,
  nameMismatch,
  checked,
  onChecked,
}: {
  memberId: string
  cnicName: string | null
  /** 'staff' = may tick and mark; 'owner' = may clear a mark; 'view' = read only. */
  mode: 'staff' | 'owner' | 'view'
  nameMismatch: boolean
  checked: boolean
  onChecked: (v: boolean) => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const mark = async (mismatch: boolean) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/documents/name-mismatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, mismatch }),
    })
    setBusy(false)
    if (ok) {
      toast.success(mismatch ? 'Marked. The Owner will decide this CNIC.' : 'Mark cleared.')
      router.refresh()
    } else toast.error(data?.error ?? 'That did not save. Please try again.')
  }

  return (
    <div className="space-y-1 rounded-lg border border-gray-200 bg-tm-bg p-2 text-[11px]">
      <p className="text-gray-700">
        Name on CNIC: <span className="font-bold text-tm-navy">{cnicName || 'not entered'}</span>
      </p>
      {nameMismatch ? (
        <div className="space-y-1">
          <p className="font-bold text-tm-red">Marked: the name on the card does not match the Name on CNIC.</p>
          {mode === 'owner' && (
            <button type="button" disabled={busy} onClick={() => void mark(false)} className="min-h-[32px] font-bold text-tm-navy underline disabled:opacity-50">
              Clear the mark
            </button>
          )}
        </div>
      ) : mode === 'staff' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-[32px] items-center gap-2 font-semibold text-tm-navy">
            <input type="checkbox" checked={checked} onChange={(e) => onChecked(e.target.checked)} className="h-4 w-4" />
            The name on the card matches
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void mark(true)}
            className="min-h-[32px] rounded-lg border border-tm-red px-2 font-bold text-tm-red disabled:opacity-50"
          >
            Name doesn&apos;t match
          </button>
        </div>
      ) : null}
    </div>
  )
}
