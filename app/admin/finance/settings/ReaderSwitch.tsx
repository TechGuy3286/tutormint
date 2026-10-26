'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// The Owner's on/off switch for the bank email reader. adminFetch handles the
// fresh-password prompt; the server checks Owner-only and audits the change.

export default function ReaderSwitch({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)

  if (readOnly) return <p className="text-[11px] text-gray-500">View only.</p>

  const flip = async () => {
    const next = !enabled
    const ok = await confirm({
      title: next ? 'Switch the bank email reader on?' : 'Switch the bank email reader off?',
      body: next
        ? 'It will read the last 30 days of Faysal Bank alerts on its next run, then new ones every 5 minutes.'
        : 'New bank credits will no longer be added from email. Nothing already added changes.',
      confirmLabel: next ? 'Switch on' : 'Switch off',
      destructive: !next,
    })
    if (!ok) return
    setBusy(true)
    const res = await adminFetch('/api/admin/finance/bank-reader', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error((res.data as { error?: string })?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(next ? 'Bank email reader switched on.' : 'Bank email reader switched off.')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
      <span className="text-xs font-bold text-tm-navy">Bank email reader is {enabled ? 'on' : 'off'}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Bank email reader"
        disabled={busy || (!enabled && !configured)}
        onClick={() => void flip()}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 text-xs font-bold disabled:opacity-60 ${
          enabled ? 'border border-gray-200 bg-white text-slate-700 hover:border-tm-red' : 'bg-tm-navy text-white hover:bg-tm-navy-hover'
        }`}
      >
        {enabled ? 'Switch off' : 'Switch on'}
      </button>
    </div>
  )
}
