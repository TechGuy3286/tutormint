'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Claim a sign-up that came without your link (owner, 15 Oct 2026): the mobile
// number or email they signed up with, and a short note. The Owner or Admin
// reviews it.

export default function ClaimForm() {
  const [identifier, setIdentifier] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/staff-signups/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, note }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That claim was not sent. Please try again.')
      return
    }
    toast.success('Claim sent. The Owner or Admin will review it.')
    setIdentifier('')
    setNote('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-black text-tm-navy">Claim a sign-up</h2>
      <p className="text-xs text-gray-600">
        Someone you helped joined without your link or code? Enter the mobile number or email they signed up with. Only
        accounts from the last 30 days with no credit yet can be claimed.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-gray-600">Mobile number or email</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            maxLength={320}
            autoComplete="off"
            className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-tm-bg p-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-gray-600">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            maxLength={500}
            placeholder="How did you help?"
            className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-tm-bg p-2 text-sm"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy || !identifier.trim() || !note.trim()}
        className="min-h-[44px] rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send claim'}
      </button>
    </form>
  )
}
