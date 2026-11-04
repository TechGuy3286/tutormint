'use client'

import { useState } from 'react'
import { Check, Loader2, UserRound } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { OwnerOnlyNote, useAdminReadOnly, useCanApprove } from '@/components/admin/ReadOnly'
import { NAME_CHANGED_LABEL } from '@/lib/memberLocksCore'
import { formatDate } from '@/lib/datetime'

// "Name changed — check against CNIC" (owner, 4 Nov 2026). A tutor with an
// approved CNIC changed their name: it was saved and the Verified badge stays.
// The Owner compares it with the CNIC and taps "Name checked"; changing the
// name back is done on the Edit tab as usual.

export default function NameChangeCheck({
  tutorId,
  from,
  to,
  since,
}: {
  tutorId: string
  from: string | null
  to: string
  since: string
}) {
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const owner = useCanApprove()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  if (done) return null

  const check = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/tutors/name-checked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId }),
    })
    setBusy(false)
    if (ok) {
      setDone(true)
      toast.success('Name checked.')
    } else toast.error(data?.error ?? 'Could not save that.')
  }

  return (
    <section data-name-change="" className="space-y-2 rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-4">
      <p className="flex items-center gap-1.5 text-xs font-black text-tm-gold-ink">
        <UserRound aria-hidden size={14} /> {NAME_CHANGED_LABEL}
      </p>
      <p className="text-[11px] text-gray-700">
        {from ? (
          <>
            Was <span className="font-bold">{from}</span>, now <span className="font-bold">{to}</span>
          </>
        ) : (
          <>Now <span className="font-bold">{to}</span></>
        )}{' '}
        · changed {formatDate(since)}. The Verified badge stays.
      </p>
      {owner && !readOnly ? (
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-tm-green-deep px-3 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Name checked
        </button>
      ) : (
        <OwnerOnlyNote />
      )}
    </section>
  )
}
