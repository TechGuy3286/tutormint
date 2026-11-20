'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Undo2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Owner only (PR-11): Allow (reason required) / Undo / Keep blocked on one
// blocked re-sign-up. The server asks for the password again when it is stale.

export default function BlockedSignupActions({ attemptId, allowed, reviewed }: { attemptId: string; allowed: boolean; reviewed: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const post = async (body: Record<string, string>, done: string) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/blocked-signups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId, ...body }),
    })
    setBusy(false)
    if (ok) {
      toast.success(done)
      router.refresh()
    } else toast.error(data?.error ?? 'That did not save. Please try again.')
  }

  const allow = async () => {
    const reason = window.prompt('Why may this person sign up again? (kept in the audit log)')
    if (reason == null) return
    if (reason.trim().length < 3) {
      toast.error('Write a short reason for the record.')
      return
    }
    await post({ action: 'allow', reason: reason.trim() }, 'Allowed. This number can sign up again. Use Undo to block it again.')
  }

  const btn = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold disabled:opacity-60'
  if (allowed) {
    return (
      <button type="button" disabled={busy} onClick={() => void post({ action: 'undo' }, 'Undone. This number is blocked again.')} className={`${btn} border border-tm-red text-tm-red`}>
        <Undo2 aria-hidden size={13} />
        Undo
      </button>
    )
  }
  return (
    <span className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void allow()} className={`${btn} bg-tm-navy text-white`}>
        <ShieldCheck aria-hidden size={13} />
        Allow
      </button>
      {!reviewed && (
        <button type="button" disabled={busy} onClick={() => void post({ action: 'keep' }, 'Kept blocked.')} className={`${btn} border border-gray-300 bg-white text-tm-navy`}>
          Keep blocked
        </button>
      )}
    </span>
  )
}
