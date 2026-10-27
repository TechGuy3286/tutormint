'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { HIDE_NUMBERS_LABEL } from '@/lib/tuitionConsentCore'

// The Owner's switch (owner, 27 Oct 2026). adminFetch handles the fresh-password
// prompt; the server checks Owner-only and writes the change to Audit.

export default function HideNumbersSwitch({ on }: { on: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)

  if (readOnly) return <p className="text-[11px] text-gray-500">View only. The Owner changes this.</p>

  const flip = async () => {
    const next = !on
    const ok = await confirm({
      title: next ? 'Hide parent numbers again?' : 'Show parent numbers on tuitions without consent?',
      body: next
        ? 'Tutors will not see the parent’s number on tuitions where consent is not recorded. They can still apply.'
        : 'Tutors will be able to view the parent’s number on tuitions where consent is not recorded, using their reveals as before.',
      confirmLabel: next ? 'Hide numbers' : 'Show numbers',
      destructive: !next,
    })
    if (!ok) return
    setBusy(true)
    const res = await adminFetch('/api/admin/settings/hide-numbers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: next }),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error((res.data as { error?: string })?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(next ? 'Parent numbers are hidden when consent isn’t recorded.' : 'Parent numbers are shown again on every tuition.')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
      <span className="text-xs font-bold text-tm-navy">
        {HIDE_NUMBERS_LABEL}: {on ? 'on' : 'off'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={HIDE_NUMBERS_LABEL}
        disabled={busy}
        onClick={() => void flip()}
        className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold disabled:opacity-60 ${
          on ? 'border border-gray-200 bg-white text-slate-700 hover:border-tm-red' : 'bg-tm-navy text-white hover:bg-tm-navy-hover'
        }`}
      >
        {on ? 'Switch off' : 'Switch on'}
      </button>
    </div>
  )
}
