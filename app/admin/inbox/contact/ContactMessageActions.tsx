'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { useToast } from '@/components/ui/Toast'

// Show (logged) and Done / Reopen on one contact-form message (PR-20).

export default function ContactMessageActions({ id, masked, done, canWrite }: { id: string; masked: string; done: boolean; canWrite: boolean }) {
  const toast = useToast()
  const router = useRouter()
  const [shown, setShown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = async (action: 'show' | 'done' | 'reopen') => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/contact-messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      const j = (await res.json().catch(() => ({}))) as { contact?: string; error?: string }
      if (!res.ok) {
        toast.error(j.error ?? 'That did not go through.')
        return
      }
      if (action === 'show') {
        setShown(j.contact ?? null)
        return
      }
      toast.success(action === 'done' ? 'Marked done.' : 'Moved back to new.')
      router.refresh()
    } catch {
      toast.error('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-slate-700">{shown ?? masked}</span>
      {!shown && (
        <button type="button" disabled={busy} onClick={() => void call('show')} className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-50">
          Show
        </button>
      )}
      {canWrite && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void call(done ? 'reopen' : 'done')}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-navy px-3 text-[11px] font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50"
        >
          {done ? 'Reopen' : 'Done'}
        </button>
      )}
    </div>
  )
}
